/**
 * @budget_enforcement
 *
 * Captures the "stale baseline" bug: the pre-flight grinder uses
 * `lastPromptTokens` (prior turn's API-reported `prompt_tokens`)
 * as the budget gate when it's > 0. That value reflects what came
 * INTO the prior turn — it does NOT reflect what the CURRENT turn
 * will send, which includes the prior turn's emissions as new
 * entries.
 *
 * Failure mode: a turn fetches a large page via `<get>`. The page
 * body lands as a fat log entry. On the next turn's pre-flight,
 * the grinder reads `lastPromptTokens` (small — the prior turn's
 * input size) instead of measuring the now-bloated current packet.
 * Grinder sees the small number, considers the packet safe,
 * doesn't reclaim. The dispatch goes out over budget; provider
 * returns 400; engine fails to recover. See
 * `test/digest/digest.md` (Rumsfeld essay run) for the live
 * occurrence on 2026-05-11.
 *
 * Contract: budget gating must measure the assembled packet about
 * to be sent. `lastPromptTokens` may be useful for `max_tokens`
 * derivation downstream, but it is NOT a budget gate input.
 */
import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import Entries from "../../src/agent/Entries.js";
import { countTokens } from "../../src/agent/tokens.js";
import materialize from "../helpers/materialize.js";
import TestDb from "../helpers/TestDb.js";

function pad(n) {
	return Array(n).fill("hello world test data").join(" ");
}

describe("Budget pre-flight measures the assembled packet (@budget_enforcement)", () => {
	let tdb, store, cascade;

	before(async () => {
		tdb = await TestDb.create("budget_preflight_actual");
		store = new Entries(tdb.db);
		await store.loadSchemes(tdb.db);
		cascade = {
			enforce: (args) =>
				tdb.hooks.turn.beforeDispatch.filter(
					{
						contextSize: args.contextSize,
						messages: args.messages,
						rows: args.rows,
						lastPromptTokens: args.lastPromptTokens ?? 0,
						assembledTokens: 0,
						ok: true,
						overflow: null,
					},
					{ ctx: args.ctx, rummy: args.rummy },
				),
		};
	});

	after(async () => {
		await tdb.cleanup();
	});

	it("grinder gates on the assembled packet, not on prior-turn lastPromptTokens", async () => {
		const { runId, loopId } = await tdb.seedRun({ alias: "preflight_actual" });

		// Seed a fat `<get>` log entry from turn 1 (prior turn). This is
		// what T(n-1)'s emission looked like — a bulk page fetch.
		const fatBody = pad(2000);
		await store.set({
			runId,
			turn: 1,
			loopId,
			path: "log://1/1/1/get",
			body: fatBody,
			state: "resolved",
			visibility: "indexed",
		});

		// Materialize for current turn (turn 2) — fat log entry is part
		// of the assembled context now.
		await materialize(tdb.db, {
			runId,
			loopId,
			turn: 2,
			systemPrompt: "test",
		});
		const rows = await tdb.db.get_turn_context.all({
			run_id: runId,
			turn: 2,
		});
		for (const r of rows) {
			if (r.scheme === "log") {
				r.aTokens = countTokens(r.body);
				r.vBody = r.body;
			}
		}

		// Build messages where the user message carries the fat body —
		// i.e., the CURRENT assembled packet far exceeds the ceiling.
		const messages = [
			{ role: "system", content: "test" },
			{ role: "user", content: fatBody },
		];
		const actualPacketTokens =
			countTokens(messages[0].content) + countTokens(messages[1].content);

		// The bug-trigger: pass a SMALL `lastPromptTokens` value (as
		// happens when the prior turn's input was small but its OUTPUT
		// was big). With contextSize=1000 (ceiling=900), a baseline of
		// 100 lies that the packet is fine; the actual packet is much
		// bigger (~10x ceiling).
		assert.ok(
			actualPacketTokens > 900,
			`sanity: assembled packet (${actualPacketTokens} tokens) should exceed ceiling (900) for this test to be meaningful`,
		);

		await cascade.enforce({
			contextSize: 1000,
			messages,
			rows,
			lastPromptTokens: 100, // The lie: small prior-turn count.
			ctx: {
				runId,
				loopId,
				turn: 2,
				systemPrompt: "test",
				mode: "act",
				toolSet: null,
			},
			rummy: { db: tdb.db, hooks: tdb.hooks, entries: store },
		});

		// Grinder MUST have detected actual overflow (despite the
		// misleading lastPromptTokens=100) and archived the prior-turn
		// log via layer 1.
		const stored = await tdb.db.get_known_entries.all({ run_id: runId });
		const err = stored.find(
			(r) => /^log:\/\/\d+\/2\/\d+\/error$/.test(r.path) && r.scheme === "log",
		);
		assert.ok(
			err,
			"413 error entry must be written when actual packet exceeds ceiling, regardless of lastPromptTokens",
		);
		const attrs = JSON.parse(err.attributes);
		assert.strictEqual(attrs.status, 413, "error status is 413");
		assert.match(
			err.body,
			/log:\/\/\d+\/1\/\*\* archived/,
			"layer 1 reports the prior-turn glob in the error body",
		);

		// The prior-turn log entry should now be visibility=archived.
		const archived = stored.find((r) => r.path === "log://1/1/1/get");
		assert.ok(archived, "prior-turn log entry still exists");
		assert.strictEqual(
			archived.visibility,
			"archived",
			"prior-turn log entry must be flipped to archived",
		);
	});
});

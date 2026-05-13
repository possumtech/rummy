/**
 * @budget_enforcement
 *
 * Hard 413 contract: when layer 2 (index archive, repo://manifest
 * preserved) doesn't bring the packet under ceiling, `enforce`
 * returns `ok: false`. TurnExecutor's `turn.beforeDispatch.filter`
 * consumer at `src/agent/TurnExecutor.js:134` short-circuits
 * dispatch on `!ok`, so the LLM provider is never called. This
 * test pins the gate. If the gate goes soft, the caller will
 * silently dispatch over-budget packets and the provider will
 * return 400.
 */
import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import Entries from "../../src/agent/Entries.js";
import materialize from "../helpers/materialize.js";
import TestDb from "../helpers/TestDb.js";

function pad(n) {
	return Array(n).fill("hello world test data").join(" ");
}

describe("Budget hard 413 short-circuits dispatch (@budget_enforcement)", () => {
	let tdb, store, cascade;

	before(async () => {
		tdb = await TestDb.create("budget_hard_413");
		store = new Entries(tdb.db);
		await store.loadSchemes(tdb.db);
		cascade = {
			enforce: (args) =>
				tdb.hooks.turn.beforeDispatch.filter(
					{
						contextSize: args.contextSize,
						messages: args.messages,
						rows: args.rows,
						lastPromptTokens: 0,
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

	it("over-budget packet that layer 2 can't rescue returns ok=false", async () => {
		const { runId, loopId } = await tdb.seedRun({ alias: "hard_413" });

		// No fat <get>/<set> log entries from prior turns — only the
		// (huge) current packet exists. Grinder has nothing to reclaim.
		await materialize(tdb.db, {
			runId,
			loopId,
			turn: 1,
			systemPrompt: "test",
		});
		const rows = await tdb.db.get_turn_context.all({
			run_id: runId,
			turn: 1,
		});

		// Build a packet that overflows by a wide margin and contains no
		// reclaimable replays. ceiling = floor(contextSize * 0.9) = 900.
		const messages = [
			{ role: "system", content: pad(500) },
			{ role: "user", content: pad(500) },
		];

		const result = await cascade.enforce({
			contextSize: 1000,
			messages,
			rows,
			ctx: {
				runId,
				loopId,
				turn: 1,
				systemPrompt: "test",
				mode: "act",
				toolSet: null,
			},
			rummy: { db: tdb.db, hooks: tdb.hooks, entries: store },
		});

		assert.strictEqual(
			result.ok,
			false,
			"hard overflow with no reclaimable replays must return ok=false; TurnExecutor short-circuits dispatch on this signal",
		);
		assert.ok(
			result.overflow > 0,
			`overflow must be positive; got ${result.overflow}`,
		);

		// And the 413 error entry must be on record so the model sees it
		// next turn.
		const stored = await tdb.db.get_known_entries.all({ run_id: runId });
		const err = stored.find(
			(r) => /^log:\/\/\d+\/1\/\d+\/error$/.test(r.path) && r.scheme === "log",
		);
		assert.ok(err, "413 error entry written");
		const attrs = JSON.parse(err.attributes);
		assert.strictEqual(attrs.status, 413);
		// Turn-1 overflow is the unfair-strike exception — soft.
		assert.match(
			err.body,
			/Budget overflow: index archived \(repo:\/\/manifest preserved\)\.$/,
		);
	});
});

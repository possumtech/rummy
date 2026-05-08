/**
 * Budget grinder ladder — pins the load-bearing claims of SPEC §
 * budget_enforcement at the integration tier.
 *
 * Covers @budget_enforcement. Three scenarios:
 *
 *   1. Step 2 success: previous-turn demote frees enough → enforce
 *      returns ok=true and a soft 413 error:// is written so the
 *      model sees what was auto-demoted.
 *   2. Step 3 success: step 2 frees nothing → prompt demote frees
 *      enough → ok=true, soft 413 names the prompt.
 *   3. Fork inherits parent's `next_turn` (absolute turn numbering
 *      across the lineage) so step 2's `current_turn − 1` rule
 *      points at parent's last-turn promotions on the fork's first
 *      dispatch.
 *
 * These three transitions are what make trunks-and-forks-identical
 * survivable. If any of them silently regresses, LME-style fork
 * scenarios will hard-413 before the model gets a chance to act.
 */
import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import Entries from "../../src/agent/Entries.js";
import materializeContext from "../../src/agent/materializeContext.js";
import TestDb from "../helpers/TestDb.js";

function pad(n) {
	return Array(n).fill("hello world test data").join(" ");
}

async function enforce(tdb, store, { runId, contextSize, turn, mode = "act" }) {
	const mat = await materializeContext({
		db: tdb.db,
		hooks: tdb.hooks,
		entries: store,
		runId,
		loopId: null,
		turn,
		systemPrompt: "test",
		mode,
		toolSet: null,
		contextSize,
	});
	return tdb.hooks.turn.beforeDispatch.filter(
		{
			contextSize,
			messages: mat.messages,
			rows: mat.rows,
			lastPromptTokens: 0,
			assembledTokens: 0,
			ok: true,
			overflow: null,
		},
		{
			ctx: {
				runId,
				loopId: null,
				turn,
				systemPrompt: "test",
				mode,
				toolSet: null,
			},
			rummy: { db: tdb.db, hooks: tdb.hooks, entries: store },
		},
	);
}

async function findError(tdb, runId, turn) {
	const rows = await tdb.db.get_known_entries.all({ run_id: runId });
	return rows.find(
		(r) =>
			r.scheme === "log" &&
			r.path.startsWith(`log://turn_${turn}/error/`) &&
			JSON.parse(r.attributes).status === 413,
	);
}

describe("Budget grinder ladder (@budget_enforcement)", () => {
	let tdb, store;

	before(async () => {
		tdb = await TestDb.create("budget_grinder");
		store = new Entries(tdb.db);
		await store.loadSchemes(tdb.db);
	});

	after(async () => {
		await tdb.cleanup();
	});

	describe("Step 2: previous-turn demotion", () => {
		it("frees enough → enforce returns ok=true; soft 413 emitted with demoted list", async () => {
			const { runId } = await tdb.seedRun({ alias: "step2_success" });
			// Big visible content at turn 0. vBody = full body; sBody for
			// known:// is body-cap previewed (≤ SUMMARY_MAX_CHARS). The
			// premium between them creates the headroom step 2 frees.
			for (let i = 0; i < 3; i++) {
				await store.set({
					runId,
					turn: 0,
					path: `known://big_${i}`,
					body: pad(80),
					state: "resolved",
					visibility: "visible",
				});
			}

			const result = await enforce(tdb, store, {
				runId,
				contextSize: 5000,
				turn: 1,
			});

			assert.strictEqual(
				result.ok,
				true,
				"step 2 fits under ceiling → run continues",
			);

			const err = await findError(tdb, runId, 1);
			assert.ok(err, "soft 413 error:// emitted");
			const attrs = JSON.parse(err.attributes);
			assert.ok(
				attrs.demotedCount >= 3,
				"at least the 3 seeded entries demoted",
			);
			assert.ok(attrs.demotedTokens > 0, "some tokens reported demoted");
			assert.ok(
				err.body.includes("known://big_0"),
				"demoted paths named in error body",
			);

			// DB state: turn-0 visible entries are now summarized.
			const dbRows = await tdb.db.get_known_entries.all({ run_id: runId });
			for (let i = 0; i < 3; i++) {
				const e = dbRows.find((r) => r.path === `known://big_${i}`);
				assert.strictEqual(
					e.visibility,
					"summarized",
					`known://big_${i} flipped to summarized`,
				);
				assert.strictEqual(e.state, "resolved", "status preserved");
			}
		});
	});

	describe("Step 3: current-prompt demotion", () => {
		it("step 2 frees nothing → prompt demote fits → ok=true", async () => {
			const { runId } = await tdb.seedRun({ alias: "step3_success" });
			// No turn-0 visible content (so step 2 demotes nothing).
			// Place a large prompt at the dispatching turn — its sBody
			// (≤ SUMMARY_MAX_CHARS slice) is the headroom step 3 frees.
			await store.set({
				runId,
				turn: 1,
				path: "prompt://1",
				body: pad(300),
				state: "resolved",
				visibility: "visible",
				attributes: { mode: "act" },
			});

			const result = await enforce(tdb, store, {
				runId,
				contextSize: 5000,
				turn: 1,
			});

			assert.strictEqual(
				result.ok,
				true,
				"step 3 fits under ceiling → run continues",
			);

			const err = await findError(tdb, runId, 1);
			assert.ok(err, "soft 413 error:// emitted on step-3 demotion");
			const attrs = JSON.parse(err.attributes);
			assert.strictEqual(
				attrs.demotedCount,
				1,
				"exactly one demotion (the prompt)",
			);
			assert.ok(
				err.body.includes("prompt://1"),
				"prompt path named in error body",
			);

			const dbRows = await tdb.db.get_known_entries.all({ run_id: runId });
			const prompt = dbRows.find((r) => r.path === "prompt://1");
			assert.strictEqual(
				prompt.visibility,
				"summarized",
				"prompt flipped to summarized",
			);
		});
	});

	describe("Fork inherits parent's next_turn (absolute turn numbering)", () => {
		it("setNextTurn after forkEntries lands child at parent_last + 1", async () => {
			const { projectId, runId: parentId } = await tdb.seedRun({
				alias: "lineage_parent",
			});
			// Advance parent's next_turn to 5 (would dispatch turn 5 next).
			for (let i = 0; i < 4; i++) {
				await tdb.db.next_turn.run({ run_id: parentId });
			}
			const parent = await tdb.db.get_run_by_id.get({ id: parentId });
			assert.strictEqual(parent.next_turn, 5, "parent advanced to next_turn=5");

			// Seed visible content at parent's last turn (4). The fork
			// inherits this and step 2 on the fork's first dispatch
			// (turn 5) targets `current_turn − 1 = 4`, so the inherited
			// entries are reachable to the grinder.
			await store.set({
				runId: parentId,
				turn: 4,
				path: "known://parent_last_turn_artifact",
				body: pad(50),
				state: "resolved",
				visibility: "visible",
			});

			// Mirror AgentLoop's fork branch: create child with
			// parent_run_id, copy run_views, inherit next_turn.
			const childRow = await tdb.db.create_run.get({
				project_id: projectId,
				parent_run_id: parentId,
				model: null,
				alias: "lineage_child",
				temperature: null,
				persona: null,
				context_limit: null,
			});
			await store.forkEntries(parentId, childRow.id);
			await store.setNextTurn(childRow.id, parent.next_turn);

			const child = await tdb.db.get_run_by_id.get({ id: childRow.id });
			assert.strictEqual(
				child.next_turn,
				parent.next_turn,
				"fork's next_turn equals parent's so step 2 sees parent's last turn",
			);

			// Sanity: inherited run_views keep their parent-side turn.
			const childViews = await tdb.db.get_known_entries.all({
				run_id: childRow.id,
			});
			const inherited = childViews.find(
				(r) => r.path === "known://parent_last_turn_artifact",
			);
			assert.ok(inherited, "fork inherits parent's run_views");

			// Step 2 on the fork's first dispatch (turn 5) demotes the
			// inherited turn-4 entries — the grinder's `current_turn − 1`
			// rule resolves cleanly because turn numbering is absolute.
			const targets = await tdb.db.get_turn_demotion_targets.all({
				run_id: childRow.id,
				turn: 4,
			});
			const paths = targets.map((t) => t.path);
			assert.ok(
				paths.includes("known://parent_last_turn_artifact"),
				"step 2 (current_turn − 1 = 4) reaches inherited content",
			);
		});
	});
});

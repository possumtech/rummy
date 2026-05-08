/**
 * Budget demotion integration tests.
 *
 * Covers @budget_enforcement — the `demote_turn_entries` SQL behind
 * step 2 of the pre-LLM grinder ladder. Flips every visible
 * run_views row at the target turn to `visibility=summarized` while
 * preserving status (a successful operation stays at 200 because
 * budget demotion is a lifecycle event, not a body-operation
 * failure). All schemes participate uniformly — no exemption for
 * knowns/unknowns.
 */
import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import Entries from "../../src/agent/Entries.js";
import TestDb from "../helpers/TestDb.js";

describe("Budget demotion", () => {
	let tdb, store;

	before(async () => {
		tdb = await TestDb.create("budget_demotion");
		store = new Entries(tdb.db);
		await store.loadSchemes(tdb.db);
	});

	after(async () => {
		await tdb.cleanup();
	});

	describe("demote_turn_entries SQL", () => {
		it("demotes promoted entries to visibility=summarized without changing status", async () => {
			const { runId } = await tdb.seedRun({ alias: "dte_1" });

			await store.set({
				runId,
				turn: 3,
				path: "https://example.com/page-a",
				body: "page-a content",
				state: "resolved",
				visibility: "visible",
			});
			await store.set({
				runId,
				turn: 3,
				path: "https://example.com/page-b",
				body: "page-b content",
				state: "resolved",
				visibility: "visible",
			});

			await tdb.db.demote_turn_entries.run({ run_id: runId, turn: 3 });

			const entries = await tdb.db.get_known_entries.all({ run_id: runId });
			const a = entries.find((e) => e.path === "https://example.com/page-a");
			const b = entries.find((e) => e.path === "https://example.com/page-b");

			assert.strictEqual(a.visibility, "summarized", "page-a demoted");
			assert.strictEqual(a.state, "resolved", "page-a status preserved at 200");
			assert.strictEqual(b.visibility, "summarized", "page-b demoted");
			assert.strictEqual(b.state, "resolved", "page-b status preserved at 200");
		});

		it("demotes logging entries at the same turn, status preserved", async () => {
			const { runId } = await tdb.seedRun({ alias: "dte_log" });

			await store.set({
				runId,
				turn: 5,
				path: "get://turn_5/file.js",
				body: "file body",
				state: "resolved",
				visibility: "visible",
			});

			await tdb.db.demote_turn_entries.run({ run_id: runId, turn: 5 });

			const entries = await tdb.db.get_known_entries.all({ run_id: runId });
			const entry = entries.find((e) => e.path === "get://turn_5/file.js");
			assert.strictEqual(
				entry.visibility,
				"summarized",
				"logging entry demoted",
			);
			assert.strictEqual(entry.state, "resolved", "status preserved");
		});

		it("does not demote entries from other turns", async () => {
			const { runId } = await tdb.seedRun({ alias: "dte_2" });

			await store.set({
				runId,
				turn: 2,
				path: "https://example.com/turn2",
				body: "earlier page",
				state: "resolved",
				visibility: "visible",
			});
			await store.set({
				runId,
				turn: 4,
				path: "https://example.com/turn4",
				body: "later page",
				state: "resolved",
				visibility: "visible",
			});

			await tdb.db.demote_turn_entries.run({ run_id: runId, turn: 3 });

			const entries = await tdb.db.get_known_entries.all({ run_id: runId });
			const t2 = entries.find((e) => e.path === "https://example.com/turn2");
			const t4 = entries.find((e) => e.path === "https://example.com/turn4");
			assert.strictEqual(t2.visibility, "visible", "turn 2 entry untouched");
			assert.strictEqual(t4.visibility, "visible", "turn 4 entry untouched");
		});

		it("does not demote entries already in error state", async () => {
			const { runId } = await tdb.seedRun({ alias: "dte_3" });

			await store.set({
				runId,
				turn: 6,
				path: "https://example.com/errored",
				body: "body",
				state: "failed",
				visibility: "visible",
			});

			await tdb.db.demote_turn_entries.run({ run_id: runId, turn: 6 });

			const entries = await tdb.db.get_known_entries.all({ run_id: runId });
			const entry = entries.find(
				(e) => e.path === "https://example.com/errored",
			);
			assert.strictEqual(entry.visibility, "visible", "4xx entry not demoted");
		});

		it("demotes all schemes uniformly — knowns and unknowns included", async () => {
			const { runId } = await tdb.seedRun({ alias: "dte_uniform" });

			await store.set({
				runId,
				turn: 7,
				path: "known://geography/lost_river",
				body: "Lost River flows underground through karst conduits.",
				state: "resolved",
				visibility: "visible",
			});
			await store.set({
				runId,
				turn: 7,
				path: "unknown://geography/aquifers",
				body: "Aquifer composition under Orange County",
				state: "resolved",
				visibility: "visible",
			});
			await store.set({
				runId,
				turn: 7,
				path: "https://example.com/source",
				body: "source URL the model fetched and is done with",
				state: "resolved",
				visibility: "visible",
			});

			const targets = await tdb.db.get_turn_demotion_targets.all({
				run_id: runId,
				turn: 7,
			});
			const targetPaths = targets.map((t) => t.path);
			assert.ok(
				targetPaths.includes("known://geography/lost_river"),
				"known:// is a demotion target",
			);
			assert.ok(
				targetPaths.includes("unknown://geography/aquifers"),
				"unknown:// is a demotion target",
			);
			assert.ok(
				targetPaths.includes("https://example.com/source"),
				"source URL is a demotion target",
			);

			await tdb.db.demote_turn_entries.run({ run_id: runId, turn: 7 });

			const entries = await tdb.db.get_known_entries.all({ run_id: runId });
			for (const path of [
				"known://geography/lost_river",
				"unknown://geography/aquifers",
				"https://example.com/source",
			]) {
				const e = entries.find((x) => x.path === path);
				assert.strictEqual(
					e.visibility,
					"summarized",
					`${path} demoted (no scheme exemption)`,
				);
				assert.strictEqual(e.state, "resolved", `${path} status preserved`);
			}
		});
	});
});

import assert from "node:assert";
import { dirname, join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import Entries from "../../src/agent/Entries.js";
import materialize from "../helpers/materialize.js";

const _pluginsDir = join(
	dirname(fileURLToPath(import.meta.url)),
	"../../src/plugins",
);

import TestDb from "../helpers/TestDb.js";

let RUN_ID;
let _PROJECT;

function pad(n) {
	return Array(n).fill("hello").join(" ");
}

describe("Engine integration (@materialization, @upsert_semantics, @engine_plugin, @plugins_views, @glossary)", () => {
	let tdb;
	let store;

	before(async () => {
		tdb = await TestDb.create();
		store = new Entries(tdb.db);
		const seed = await tdb.seedRun({ alias: "engine_1" });
		RUN_ID = seed.runId;
		LOOP_ID = seed.loopId;
		_PROJECT = { id: seed.projectId, project_root: "/tmp/test", name: "Test" };
	});

	beforeEach(async () => {
		await store.rm({ runId: RUN_ID, path: "*", pattern: true });
	});

	after(async () => {
		await tdb.cleanup();
	});

	describe("context materialization", () => {
		it("materializes entries into turn_context", async () => {
			await store.set({
				runId: RUN_ID,
				loopId: LOOP_ID,
				turn: 1,
				path: "src/small.js",
				body: pad(100),
				state: "resolved",
			});
			await store.set({
				runId: RUN_ID,
				loopId: LOOP_ID,
				turn: 1,
				path: "known://note",
				body: "short",
				state: "resolved",
			});

			await materialize(tdb.db, {
				runId: RUN_ID,
				loopId: LOOP_ID,
				turn: 1,
				systemPrompt: "test system prompt",
			});

			const rows = await tdb.db.get_turn_context.all({
				run_id: RUN_ID,
				turn: 1,
			});
			assert.ok(rows.length > 0, "turn_context should have entries");
			const file = rows.find((r) => r.path === "src/small.js");
			assert.ok(file, "file should be in turn_context");
		});

		it("includes system prompt as first entry", async () => {
			await materialize(tdb.db, {
				runId: RUN_ID,
				loopId: LOOP_ID,
				turn: 1,
				systemPrompt: "test system prompt",
			});

			const rows = await tdb.db.get_turn_context.all({
				run_id: RUN_ID,
				turn: 1,
			});
			const system = rows.find((r) => r.path === "system://prompt");
			assert.ok(system, "system prompt should be in turn_context");
			assert.strictEqual(
				system.ordinal,
				0,
				"system prompt should be ordinal 0",
			);
			assert.ok(
				system.body.includes("test system prompt"),
				"system prompt body should match",
			);
		});
	});

	describe("tokens accounting", () => {
		it("tokens unchanged through archive and re-index cycle", async () => {
			await store.set({
				runId: RUN_ID,
				loopId: LOOP_ID,
				turn: 1,
				path: "known://test_entry",
				body: pad(200),
				state: "resolved",
			});

			const original = await store.getEntriesByPattern(
				RUN_ID,
				"known://test_entry",
				null,
			);
			const originalTokens = original[0].tokens;
			assert.ok(originalTokens > 0, "tokens set on creation");

			await store.set({
				runId: RUN_ID,
				loopId: LOOP_ID,
				path: "known://test_entry",
				visibility: "archived",
			});
			const archived = await store.getEntriesByPattern(
				RUN_ID,
				"known://test_entry",
				null,
			);
			assert.strictEqual(
				archived[0].tokens,
				originalTokens,
				"tokens unchanged after archive",
			);

			await store.get({ runId: RUN_ID, turn: 3, path: "known://test_entry" });
			const reindexed = await store.getEntriesByPattern(
				RUN_ID,
				"known://test_entry",
				null,
			);
			assert.strictEqual(
				reindexed[0].tokens,
				originalTokens,
				"tokens unchanged after re-index",
			);
		});
	});
});

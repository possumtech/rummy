/**
 * Schema V2 invariants.
 *
 * Covers @schema, @schemes_status_visibility — constraint-level
 * claims the database layer enforces.
 *
 * Not covered here:
 * - "`known_entries` is a read-only VIEW" is a SQLite guarantee (views
 *   without INSTEAD OF triggers reject writes); the testable discipline
 *   is "no prep targets `known_entries` for writes" — a grep check,
 *   not a runtime test.
 * - Scope is free-form text by design (Phase D); narrowing would be
 *   a deliberate future change, not a current invariant to enforce.
 */
import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import Entries from "../../src/agent/Entries.js";
import TestDb from "../helpers/TestDb.js";

describe("Schema V2 invariants", () => {
	let tdb;
	let store;

	before(async () => {
		tdb = await TestDb.create("schema_v2");
		store = new Entries(tdb.db);
	});

	after(async () => {
		await tdb.cleanup();
	});

	describe("visibility constraint", () => {
		it("accepts the two canonical values (indexed/archived)", async () => {
			const { runId, loopId } = await tdb.seedRun({ alias: "fid_accept" });
			for (const visibility of ["indexed", "archived"]) {
				await store.set({
					runId,
					turn: 1,
					loopId,
					path: `known://fid-${visibility}`,
					body: "body",
					state: "resolved",
					visibility,
				});
			}
		});

		it("rejects stale visibility vocabulary", async () => {
			const { runId, loopId } = await tdb.seedRun({ alias: "fid_reject" });
			for (const stale of ["visible", "summarized", "full", "summary"]) {
				await assert.rejects(
					store.set({
						runId,
						loopId,
						turn: 1,
						path: `known://fid-${stale}`,
						body: "body",
						state: "resolved",
						visibility: stale,
					}),
					/constraint|CHECK|visibility/i,
					`visibility="${stale}" must be rejected`,
				);
			}
		});
	});

	describe("entries + run_views separation", () => {
		it("entries.scope defaults to 'run:<runId>' for default-scope schemes", async () => {
			const { runId, loopId } = await tdb.seedRun({ alias: "scope_default" });
			await store.set({
				runId,
				turn: 1,
				loopId,
				path: "known://scoped",
				body: "content",
				state: "resolved",
				writer: "model",
			});
			const all = await tdb.db.get_known_entries.all({ run_id: runId });
			const row = all.find((e) => e.path === "known://scoped");
			assert.ok(row, "entry visible via compat view");
			assert.strictEqual(row.scope, `run:${runId}`);
		});

		it("writing an entry creates one content row and one view row", async () => {
			const { runId: a, loopId: loopA } = await tdb.seedRun({ alias: "dup_a" });
			const { runId: b, loopId: loopB } = await tdb.seedRun({ alias: "dup_b" });
			await store.set({
				runId: a,
				loopId: loopA,
				turn: 1,
				path: "known://sharedpath",
				body: "A body",
				state: "resolved",
			});
			await store.set({
				runId: b,
				loopId: loopB,
				turn: 1,
				path: "known://sharedpath",
				body: "B body",
				state: "resolved",
			});

			// Two runs, two content rows (different scopes), two view rows.
			const aRows = await tdb.db.get_known_entries.all({ run_id: a });
			const bRows = await tdb.db.get_known_entries.all({ run_id: b });
			const aMatch = aRows.find((r) => r.path === "known://sharedpath");
			const bMatch = bRows.find((r) => r.path === "known://sharedpath");
			assert.strictEqual(aMatch.body, "A body");
			assert.strictEqual(bMatch.body, "B body");
			assert.notStrictEqual(
				aMatch.scope,
				bMatch.scope,
				"run-scoped entries live in separate scopes",
			);
		});
	});
});

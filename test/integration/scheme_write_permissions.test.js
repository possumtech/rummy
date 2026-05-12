/**
 * Scheme write permissions: model is gated to registered schemes only.
 *
 * Covers @scheme_registry — the boundary between paradigmatic surfaces
 * (registered schemes) and the model's freedom to invent paths. Today
 * the fallback in Entries.#schemeRules silently grants ["model",
 * "plugin"] writability to any unregistered scheme, so a model can
 * write to `bogus://x` and get no feedback. This test pins the strict
 * behavior: unregistered scheme + model writer raises PermissionError,
 * which the dispatch layer turns into an error.log entry and a strike.
 *
 * Also pins the rummy.repo scheme as plugin-only — the manifest tile
 * is engine-maintained orientation, not a model-writable surface.
 */
import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import Entries from "../../src/agent/Entries.js";
import { PermissionError } from "../../src/agent/errors.js";
import TestDb from "../helpers/TestDb.js";

describe("Scheme write permissions", () => {
	let tdb, store;

	before(async () => {
		tdb = await TestDb.create("scheme_write_permissions");
		store = new Entries(tdb.db);

		await tdb.db.upsert_scheme.run({
			name: "repo",
			model_visible: 1,
			category: "data",
			default_scope: "run",
			writable_by: JSON.stringify(["plugin"]),
			volatile: 0,
		});
	});

	after(async () => {
		await tdb.cleanup();
	});

	it("model write to unregistered scheme raises PermissionError", async () => {
		const { runId } = await tdb.seedRun({ alias: "perm_unknown_model" });

		await assert.rejects(
			store.set({
				runId,
				turn: 1,
				path: "bogus://something",
				body: "attempt",
				state: "resolved",
				writer: "model",
			}),
			(err) =>
				err instanceof PermissionError &&
				err.scheme === "bogus" &&
				err.writer === "model",
		);
	});

	it("plugin write to unregistered scheme is allowed (plumbing-friendly)", async () => {
		const { runId } = await tdb.seedRun({ alias: "perm_unknown_plugin" });

		await store.set({
			runId,
			turn: 1,
			path: "novel://probe",
			body: "engine-side write",
			state: "resolved",
			writer: "plugin",
		});

		const body = await store.getBody(runId, "novel://probe");
		assert.strictEqual(body, "engine-side write");
	});

	it("model write to repo:// scheme raises PermissionError", async () => {
		const { runId } = await tdb.seedRun({ alias: "perm_repo_model" });

		await assert.rejects(
			store.set({
				runId,
				turn: 1,
				path: "repo://compile.sh",
				body: "#!/bin/sh\necho hi",
				state: "resolved",
				writer: "model",
			}),
			(err) =>
				err instanceof PermissionError &&
				err.scheme === "repo" &&
				err.writer === "model",
		);
	});

	it("plugin write to repo://manifest succeeds", async () => {
		const { runId } = await tdb.seedRun({ alias: "perm_repo_plugin" });

		await store.set({
			runId,
			turn: 0,
			path: "repo://manifest",
			body: '{"path":"a.txt","tokens":4}',
			state: "resolved",
			writer: "plugin",
		});

		const body = await store.getBody(runId, "repo://manifest");
		assert.strictEqual(body, '{"path":"a.txt","tokens":4}');
	});
});

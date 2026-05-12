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
 *
 * Handler-level gating: `<set path="X" archive/>` (pure visibility,
 * no body) and `<set path="X"><<NEW>>...</NEW></set>` (body write)
 * are both model intents to mutate X. If X is in a scheme model can't
 * write, the handler must raise PermissionError up front rather than
 * silently routing through a non-checking branch.
 */
import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import Entries from "../../src/agent/Entries.js";
import { PermissionError } from "../../src/agent/errors.js";
// biome-ignore lint/suspicious/noShadowRestrictedNames: the tool plugin's class is named "Set" by design
import Set from "../../src/plugins/set/set.js";
import TestDb from "../helpers/TestDb.js";

function stubCore() {
	const filters = new Map();
	const events = new Map();
	return {
		registerScheme() {},
		ensureTool() {},
		on(name, fn) {
			if (!events.has(name)) events.set(name, []);
			events.get(name).push(fn);
		},
		filter(name, fn) {
			if (!filters.has(name)) filters.set(name, []);
			filters.get(name).push(fn);
		},
		hooks: {},
	};
}

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

	it("set handler rejects model body-write to repo:// with PermissionError", async () => {
		const { runId, loopId } = await tdb.seedRun({ alias: "handler_repo_body" });
		const plugin = new Set(stubCore());

		await assert.rejects(
			plugin.handler(
				{
					body: "#!/bin/sh",
					path: "log://1/1/1/set",
					resultPath: "log://1/1/1/set",
					attributes: { path: "repo://compile.sh", inner: "#!/bin/sh" },
				},
				{ entries: store, sequence: 1, runId, loopId },
			),
			(err) =>
				err instanceof PermissionError &&
				err.scheme === "repo" &&
				err.writer === "model",
		);
	});

	it("set handler rejects model visibility-flip on repo:// with PermissionError", async () => {
		const { runId, loopId } = await tdb.seedRun({ alias: "handler_repo_vis" });
		const plugin = new Set(stubCore());

		await assert.rejects(
			plugin.handler(
				{
					body: "",
					path: "log://1/1/1/set",
					resultPath: "log://1/1/1/set",
					attributes: { path: "repo://README.mkd", archive: true },
				},
				{ entries: store, sequence: 1, runId, loopId },
			),
			(err) =>
				err instanceof PermissionError &&
				err.scheme === "repo" &&
				err.writer === "model",
		);
	});

	it("set handler rejects model write to unregistered scheme with PermissionError", async () => {
		const { runId, loopId } = await tdb.seedRun({ alias: "handler_unknown" });
		const plugin = new Set(stubCore());

		await assert.rejects(
			plugin.handler(
				{
					body: "anything",
					path: "log://1/1/1/set",
					resultPath: "log://1/1/1/set",
					attributes: { path: "bogus://x", inner: "anything" },
				},
				{ entries: store, sequence: 1, runId, loopId },
			),
			(err) =>
				err instanceof PermissionError &&
				err.scheme === "bogus" &&
				err.writer === "model",
		);
	});
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderModel } from "../../lib/hedberg/udiff.js";
// biome-ignore lint/suspicious/noShadowRestrictedNames: the tool plugin's class is named "Set" by design
import Set from "./set.js";

// Heredoc operation the XmlParser would produce. Mirrors the shape
// parseHeredocOps returns: { op, suffix, keyword, scope, content }.
function op(kind, scope, content = "") {
	const keyword = kind.toUpperCase();
	return { op: kind, suffix: "", keyword, scope, content };
}

// Stub hooks for raw-body recover/reject path which fires soft 422.
function rummyCtx(store, overrides = {}) {
	const errors = [];
	return {
		entries: store,
		sequence: overrides.sequence ?? 1,
		runId: overrides.runId ?? "r",
		loopId: overrides.loopId ?? "l",
		_errors: errors,
		hooks: {
			error: {
				log: { emit: async (e) => errors.push(e) },
			},
		},
	};
}

// Minimal stub PluginContext: every wiring call is a captured no-op.
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
		// Test helpers — not part of the real PluginContext API.
		_get: (name) => filters.get(name) || [],
		_event: (name) => events.get(name) || [],
	};
}

function makeStore() {
	const calls = [];
	const entriesByPath = new Map();
	const states = new Map();
	const bodies = new Map();
	return {
		_calls: calls,
		setEntry(path, entry) {
			entriesByPath.set(path, entry);
			if (entry.body !== undefined) bodies.set(path, entry.body);
		},
		setState(path, state) {
			states.set(path, state);
		},
		async set(args) {
			calls.push(args);
			if (args.body !== undefined) bodies.set(args.path, args.body);
		},
		async assertWritable(_path, _writer) {
			// Mock: permissive — real Entries throws PermissionError on
			// restricted schemes; tests that pin gating live in
			// test/integration/scheme_write_permissions.test.js against
			// the real Entries.
		},
		async getEntriesByPattern(_runId, pattern, _filter) {
			if (entriesByPath.has(pattern))
				return [{ path: pattern, ...entriesByPath.get(pattern) }];
			return [];
		},
		async getBody(_runId, path) {
			return bodies.has(path) ? bodies.get(path) : null;
		},
		async getState(_runId, path) {
			return states.get(path) ?? null;
		},
	};
}

describe("Set plugin", () => {
	describe("full (visible projection)", () => {
		const plugin = new Set(stubCore());

		it("non-error entries project the stored body verbatim (body IS the canonical udiff)", () => {
			const body = "@@ -1,0 +1,1 @@\n+foo";
			const out = plugin.full({ attributes: { path: "x.js" }, body });
			assert.equal(out, body);
		});

		it("conflict no longer synthesizes a verbose error projection — body IS canonical", () => {
			// Post-udiff: handler emits soft 422 "edit recovered" / "edit
			// rejected" via the error-log channel. The action entry's view
			// is just its body, no special render for error attrs.
			const out = plugin.full({
				attributes: { path: "known://plan" },
				body: "stored body",
			});
			assert.equal(out, "stored body");
		});
	});

	describe("handler", () => {
		it("rejects body writes against log:// with method_not_allowed outcome", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			await plugin.handler(
				{
					body: "search results for X",
					path: "log://1/2/1/set",
					resultPath: "log://1/2/1/set",
					attributes: {
						path: "log://1/1/1/search",
						archive: true,
					},
				},
				{ entries: store, sequence: 2, runId: "r", loopId: "l" },
			);
			assert.equal(store._calls.length, 1);
			assert.equal(store._calls[0].state, "failed");
			assert.equal(store._calls[0].outcome, "method_not_allowed");
			assert.match(store._calls[0].body, /log:\/\/ is immutable/);
		});

		it("body-less archive on log:// is allowed", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			store.setEntry("log://1/1/1/search", { body: "results" });
			await plugin.handler(
				{
					body: "",
					path: "log://1/2/1/set",
					resultPath: "log://1/2/1/set",
					attributes: { path: "log://1/1/1/search", archive: true },
				},
				{ entries: store, sequence: 2, runId: "r", loopId: "l" },
			);
			const flip = store._calls.find(
				(c) => c.path === "log://1/1/1/search" && c.visibility === "archived",
			);
			assert.ok(flip, "archive flip on log:// goes through");
		});

		it("rejects archive+index conflict with validation outcome", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			await plugin.handler(
				{
					body: "",
					path: "log://1/1/1/set",
					resultPath: "log://1/1/1/set",
					attributes: { path: "known://x", archive: true, index: true },
				},
				{ entries: store, sequence: 1, runId: "r", loopId: "l" },
			);
			assert.equal(store._calls.length, 1);
			assert.equal(store._calls[0].state, "failed");
			assert.equal(store._calls[0].outcome, "validation");
			assert.match(store._calls[0].body, /both archive and index/);
		});

		it("archive on missing path → not_found result", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			await plugin.handler(
				{
					body: "",
					path: "log://1/1/1/set",
					resultPath: "log://1/1/1/set",
					attributes: { path: "known://missing", archive: true },
				},
				{ entries: store, sequence: 1, runId: "r", loopId: "l" },
			);
			const failed = store._calls.find((c) => c.state === "failed");
			assert.ok(failed);
			assert.equal(failed.outcome, "not_found");
			assert.match(failed.body, /not found/);
		});

		it("archive on existing entry flips visibility + logs result", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			store.setEntry("known://x", { body: "v" });
			await plugin.handler(
				{
					body: "",
					path: "log://1/1/1/set",
					resultPath: "log://1/1/1/set",
					attributes: { path: "known://x", archive: true },
				},
				{ entries: store, sequence: 1, runId: "r", loopId: "l" },
			);
			const flip = store._calls.find(
				(c) => c.path === "known://x" && c.visibility === "archived",
			);
			assert.ok(flip);
			const log = store._calls.find((c) => c.state === "resolved" && c.body);
			assert.match(log.body, /set to archived/);
		});

		it("ignores set with no path and no body (early return)", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			await plugin.handler(
				{
					body: "",
					path: "log://1/1/1/set",
					resultPath: "log://1/1/1/set",
					attributes: {},
				},
				{ entries: store, sequence: 1, runId: "r", loopId: "l" },
			);
			assert.deepEqual(store._calls, []);
		});

		it("raw-body scheme write on new path: recovered (write + soft 422)", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			const ctx = rummyCtx(store);
			await plugin.handler(
				{
					body: "v2",
					path: "log://1/1/1/set",
					resultPath: "log://1/1/1/set",
					attributes: { path: "known://x" },
				},
				ctx,
			);
			const target = store._calls.find(
				(c) => c.path === "known://x" && c.body === "v2",
			);
			assert.ok(target);
			assert.equal(target.visibility, "indexed");
			const log = store._calls.find((c) => c.path === "log://1/1/1/set");
			assert.ok(log);
			assert.equal(log.body, renderModel("", "v2"));
			assert.equal(ctx._errors.length, 1, "soft 422 fired");
			assert.equal(ctx._errors[0].status, 422);
			assert.match(ctx._errors[0].message, /recovered/);
		});

		it("raw-body scheme write on existing path: rejected (no write + soft 422)", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			store.setEntry("known://x", { body: "prior content" });
			const ctx = rummyCtx(store);
			await plugin.handler(
				{
					body: "ambiguous replacement",
					path: "log://1/1/1/set",
					resultPath: "log://1/1/1/set",
					attributes: { path: "known://x" },
				},
				ctx,
			);
			const targetWrites = store._calls.filter(
				(c) => c.path === "known://x" && c.body !== undefined,
			);
			assert.equal(targetWrites.length, 0, "no write to existing path");
			assert.equal(ctx._errors.length, 1, "soft 422 fired");
			assert.match(ctx._errors[0].message, /rejected/);
		});

		it("raw-body file write on new path: recovered as pure-insert proposal", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			const ctx = rummyCtx(store);
			await plugin.handler(
				{
					body: "new content",
					path: "log://1/1/1/set",
					resultPath: "log://1/1/1/set",
					attributes: { path: "src/foo.js" },
				},
				ctx,
			);
			const log = store._calls.find((c) => c.path === "log://1/1/1/set");
			assert.ok(log);
			assert.equal(log.state, "proposed");
			assert.equal(log.attributes.path, "src/foo.js");
			assert.equal(log.attributes.patched, "new content");
			assert.equal(log.body, renderModel("", "new content"));
			assert.equal(ctx._errors.length, 1);
			assert.match(ctx._errors[0].message, /recovered/);
		});
	});

	describe("filter wiring", () => {
		it("registers proposal.accepting and proposal.content filters", () => {
			const core = stubCore();
			new Set(core);
			assert.equal(core._get("proposal.accepting").length, 1);
			assert.equal(core._get("proposal.content").length, 1);
			assert.equal(core._get("instructions.toolDocs").length, 1);
		});

		it("registers a handler and a single view event", () => {
			const core = stubCore();
			new Set(core);
			assert.equal(core._event("handler").length, 1);
			assert.equal(core._event("view").length, 1);
		});

		it("instructions.toolDocs filter populates docsMap.set", async () => {
			const core = stubCore();
			new Set(core);
			const fn = core._get("instructions.toolDocs")[0];
			const out = await fn({});
			assert.equal(typeof out.set, "string");
			assert.ok(out.set.length > 0);
		});

		it("vetoReadonly filter passes through when an earlier filter has a value", async () => {
			const core = stubCore();
			new Set(core);
			const fn = core._get("proposal.accepting")[0];
			const existing = { allow: true };
			const out = await fn(existing, { path: "log://1/1/1/set" });
			assert.strictEqual(out, existing);
		});

		it("vetoReadonly filter passes through for non-set proposals", async () => {
			const core = stubCore();
			new Set(core);
			const fn = core._get("proposal.accepting")[0];
			const out = await fn(null, { path: "log://1/1/1/get", attrs: {} });
			assert.equal(out, null);
		});

		it("vetoReadonly filter blocks readonly file writes", async () => {
			const core = stubCore();
			new Set(core);
			const fn = core._get("proposal.accepting")[0];
			const ctx = {
				path: "log://1/1/1/set",
				attrs: { path: "src/locked.js" },
				db: {
					get_file_constraints: {
						all: async () => [
							{ pattern: "src/locked.js", visibility: "readonly" },
						],
					},
				},
				projectId: "p1",
			};
			const out = await fn(null, ctx);
			assert.equal(out.allow, false);
			assert.equal(out.outcome, "readonly");
			assert.match(out.body, /readonly/);
		});

		it("preferExistingBody returns existing body when one exists", async () => {
			const core = stubCore();
			new Set(core);
			const fn = core._get("proposal.content")[0];
			const out = await fn("default-body", {
				path: "log://1/1/1/set",
				entries: { getBody: async () => "existing-body" },
				runId: "r",
			});
			assert.equal(out, "existing-body");
		});

		it("preferExistingBody falls back to default when entry has no body", async () => {
			const core = stubCore();
			new Set(core);
			const fn = core._get("proposal.content")[0];
			const out = await fn("default-body", {
				path: "log://1/1/1/set",
				entries: { getBody: async () => null },
				runId: "r",
			});
			assert.equal(out, "default-body");
		});

		it("preferExistingBody passes through for non-set proposals", async () => {
			const core = stubCore();
			new Set(core);
			const fn = core._get("proposal.content")[0];
			const out = await fn("default", {
				path: "log://1/1/1/get",
				entries: {},
			});
			assert.equal(out, "default");
		});
	});

	// Regression: model emits `<set path=X index><<NEW...NEW></set>` —
	// both a visibility attr AND an op-bearing body. The op runs; the
	// visibility attr applies on the resulting entry.
	describe("regression: visibility attr + NEW op on new path lands the content", () => {
		it("`<set path=X index><<NEW...NEW></set>` on a non-existing path creates the entry (not not_found)", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			const ctx = rummyCtx(store);
			await plugin.handler(
				{
					body: "",
					path: "log://1/1/1/set",
					resultPath: "log://1/1/1/set",
					attributes: {
						path: "known://plan",
						index: "",
						tags: "plan",
						ops: [op("new", null, "- [ ] Draft a plan")],
					},
				},
				ctx,
			);
			const target = store._calls.find((c) => c.path === "known://plan");
			assert.ok(target, "known://plan was written");
			assert.equal(target.body, "- [ ] Draft a plan");
			assert.equal(target.visibility, "indexed");
			const log = store._calls.find(
				(c) => c.path === "log://1/1/1/set" && c.state === "resolved",
			);
			assert.ok(log, "resolved log entry, not failed not_found");
		});
	});

	describe("regression: visibility attr + raw body on new path is recovered, not not_found", () => {
		it("`<set path=X index>{body}</set>` on a non-existing file lands as a recovered proposal", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			const ctx = rummyCtx(store, { sequence: 14 });
			const newBody = "# Report\n\nFull contents.\n";
			await plugin.handler(
				{
					body: newBody,
					path: "log://1/14/1/set",
					resultPath: "log://1/14/1/set",
					attributes: {
						path: "OC_RIVERS.md",
						index: "",
						tags: "report,internal",
					},
				},
				ctx,
			);
			const log = store._calls.find((c) => c.path === "log://1/14/1/set");
			assert.ok(log, "log entry written");
			assert.equal(log.state, "proposed");
			assert.equal(log.attributes.path, "OC_RIVERS.md");
			assert.equal(log.attributes.patched, newBody);
			assert.equal(log.attributes.index, true);
			assert.equal(ctx._errors.length, 1, "soft 422 fired for the recovery");
			assert.match(ctx._errors[0].message, /recovered/);
		});
	});

	describe("bare-file heredoc-op edits emit a proposal (not a resolved entry)", () => {
		it("successful REPLACE on bare file yields state=proposed with attrs.path + attrs.patched", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			store.setEntry("src/app.js", {
				body: "old line\n",
				scheme: null,
				tokens: 2,
			});
			await plugin.handler(
				{
					body: "",
					path: "log://1/1/1/set",
					resultPath: "log://1/1/1/set",
					attributes: {
						path: "src/app.js",
						ops: [op("replace", { start: 1, end: 1 }, "new line")],
					},
				},
				{ entries: store, sequence: 1, runId: "r", loopId: "l" },
			);
			const log = store._calls.find((c) => c.path === "log://1/1/1/set");
			assert.ok(log);
			assert.equal(log.state, "proposed");
			assert.equal(log.attributes.path, "src/app.js");
			assert.match(log.attributes.patched, /new line/);
			assert.ok(
				log.attributes.patch,
				"attrs.patch carries the full udiff for client rendering",
			);
		});

		it("does not write a set:// canonical entry (no detour)", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			store.setEntry("src/app.js", {
				body: "old line\n",
				scheme: null,
				tokens: 2,
			});
			await plugin.handler(
				{
					body: "",
					path: "log://1/1/1/set",
					resultPath: "log://1/1/1/set",
					attributes: {
						path: "src/app.js",
						ops: [op("replace", { start: 1, end: 1 }, "new line")],
					},
				},
				{ entries: store, sequence: 1, runId: "r", loopId: "l" },
			);
			const canonical = store._calls.find((c) =>
				c.path?.startsWith?.("set://"),
			);
			assert.equal(canonical, undefined);
		});

		it("NEW op creates content on a missing path", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			await plugin.handler(
				{
					body: "",
					path: "log://1/1/2/set",
					resultPath: "log://1/1/2/set",
					attributes: {
						path: "known://new",
						ops: [op("new", null, "fresh body")],
					},
				},
				{ entries: store, sequence: 1, runId: "r", loopId: "l" },
			);
			const upsert = store._calls.find((c) => c.path === "known://new");
			assert.ok(upsert, "path was created");
			assert.equal(upsert.body, "fresh body");
		});

		it("REPLACE with out-of-range line on existing path: soft 422 edit rejected, no write", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			store.setEntry("known://exists", {
				body: "actual stored content\n",
				scheme: "known",
				tokens: 2,
			});
			const rummy = rummyCtx(store);
			await plugin.handler(
				{
					body: "",
					path: "log://1/1/3/set",
					resultPath: "log://1/1/3/set",
					attributes: {
						path: "known://exists",
						ops: [op("replace", { start: 99, end: 99 }, "x")],
					},
				},
				rummy,
			);
			assert.equal(rummy._errors.length, 1);
			assert.match(rummy._errors[0].message, /REPLACE\[99-99\] out of range/);
			assert.equal(rummy._errors[0].status, 422);
			assert.equal(rummy._errors[0].soft, true);
			assert.equal(
				store._calls.find((c) => c.path === "log://1/1/3/set"),
				undefined,
				"no action entry written on reject",
			);
		});

		it("APPEND on a missing path creates the entry with the appended content", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			const rummy = rummyCtx(store);
			await plugin.handler(
				{
					body: "",
					path: "log://1/1/2/set",
					resultPath: "log://1/1/2/set",
					attributes: {
						path: "known://plan",
						ops: [op("append", null, "- [ ] step 1\n- [ ] step 2")],
					},
				},
				rummy,
			);
			const targetWrite = store._calls.find(
				(c) => c.path === "known://plan" && c.body != null,
			);
			assert.ok(targetWrite);
			assert.equal(targetWrite.body, "- [ ] step 1\n- [ ] step 2");
		});

		it("DELETE with out-of-range line: soft 422 edit rejected, no write", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			store.setEntry("known://exists", {
				body: "one\ntwo\nthree\n",
				scheme: "known",
				tokens: 2,
			});
			const rummy = rummyCtx(store);
			await plugin.handler(
				{
					body: "",
					path: "log://1/1/2/set",
					resultPath: "log://1/1/2/set",
					attributes: {
						path: "known://exists",
						ops: [op("delete", { start: 99, end: 99 })],
					},
				},
				rummy,
			);
			assert.equal(rummy._errors.length, 1);
			assert.match(rummy._errors[0].message, /DELETE\[99-99\] out of range/);
			assert.equal(
				store._calls.find((c) => c.path === "log://1/1/2/set"),
				undefined,
				"no action entry written when out of range",
			);
		});

		it("op envelope attr is comma-separated unique kind list", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			store.setEntry("src/app.js", {
				body: "alpha\nbeta\ngamma\n",
				scheme: null,
				tokens: 2,
			});
			await plugin.handler(
				{
					body: "",
					path: "log://1/1/1/set",
					resultPath: "log://1/1/1/set",
					attributes: {
						path: "src/app.js",
						ops: [
							op("replace", { start: 1, end: 1 }, "ALPHA"),
							op("delete", { start: 3, end: 3 }),
						],
					},
				},
				{ entries: store, sequence: 1, runId: "r", loopId: "l" },
			);
			const log = store._calls.find((c) => c.path === "log://1/1/1/set");
			assert.equal(log.state, "proposed");
			assert.match(log.attributes.op, /replace/);
			assert.match(log.attributes.op, /delete/);
		});
	});
});

describe("Set plugin: manifest is universal", () => {
	function manifestStore(matches) {
		const calls = [];
		return {
			_calls: calls,
			async set(args) {
				calls.push(args);
			},
			async assertWritable() {},
			async getEntriesByPattern() {
				return matches;
			},
			async getBody() {
				throw new Error("manifest must not read source body");
			},
			async getState() {
				return null;
			},
			async logPath(_r, t, s, _p) {
				return `log://1/${t}/1/${s}`;
			},
		};
	}
	const matches = [
		{ path: "known://hydrology/karst", scheme: "known", tokens: 100 },
		{ path: "known://hydrology/rivers", scheme: "known", tokens: 200 },
	];

	const plugin = new Set(stubCore());
	const rummy = (store) => ({
		entries: store,
		sequence: 1,
		runId: "r",
		loopId: "l",
	});

	it("manifest + archive-pattern: lists matches without flipping visibility", async () => {
		const store = manifestStore(matches);
		await plugin.handler(
			{
				attributes: {
					path: "known://hydrology/*",
					archive: true,
					manifest: "",
				},
				body: "",
				resultPath: "set://result",
			},
			rummy(store),
		);
		const log = store._calls.find((c) => c.path?.startsWith("log://"));
		assert.ok(log, "wrote a manifest log entry");
		assert.match(log.body, /^MANIFEST set/);
		assert.match(log.body, /2 matched/);
		// No visibility-flip writes happened — only the manifest log entry.
		const visibilityFlips = store._calls.filter(
			(c) => c.visibility && c.path !== log.path,
		);
		assert.equal(
			visibilityFlips.length,
			0,
			"manifest gate must run before visibility flip",
		);
	});

	it("manifest + heredoc-op edit: lists matches without applying edit", async () => {
		const store = manifestStore(matches);
		await plugin.handler(
			{
				attributes: {
					path: "src/**/*.js",
					manifest: "",
					ops: [op("replace", { start: 1, end: 1 }, "new")],
				},
				body: "",
				resultPath: "set://result",
			},
			rummy(store),
		);
		const log = store._calls.find((c) => c.path?.startsWith("log://"));
		assert.ok(log, "manifest fires before edit branch");
		assert.match(log.body, /^MANIFEST set/);
	});

	it("manifest + raw write body: lists matches without overwriting", async () => {
		const store = manifestStore(matches);
		await plugin.handler(
			{
				attributes: { path: "known://*", manifest: "" },
				body: "would-be content",
				resultPath: "set://result",
			},
			rummy(store),
		);
		const log = store._calls.find((c) => c.path?.startsWith("log://"));
		assert.ok(log, "manifest fires before write-content branch");
		assert.match(log.body, /^MANIFEST set/);
		// No body writes to the matches happened.
		const bodyWrites = store._calls.filter(
			(c) => c.body === "would-be content",
		);
		assert.equal(
			bodyWrites.length,
			0,
			"manifest must not write body content to any matches",
		);
	});
});

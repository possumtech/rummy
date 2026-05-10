import assert from "node:assert/strict";
import { describe, it } from "node:test";
// biome-ignore lint/suspicious/noShadowRestrictedNames: the tool plugin's class is named "Set" by design
import Set from "./set.js";

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

		it("tab-indents the model's verbatim emission", () => {
			const out = plugin.full({
				attributes: { path: "x.js" },
				body: '<set path="x.js"><<NEW\nfoo\nNEW</set>',
			});
			assert.equal(out, '\t<set path="x.js"><<NEW\n\tfoo\n\tNEW</set>');
		});

		it("multi-line emissions keep one tab per line", () => {
			const body =
				'<set path="x"><<SEARCH\nold\nSEARCH<<REPLACE\nnew\nREPLACE</set>';
			const out = plugin.full({ attributes: { path: "x" }, body });
			assert.equal(
				out,
				'\t<set path="x"><<SEARCH\n\told\n\tSEARCH<<REPLACE\n\tnew\n\tREPLACE</set>',
			);
		});

		it("conflict synthesizes an error projection with attempted + current body", () => {
			const out = plugin.full({
				attributes: {
					path: "known://plan",
					error: "Could not find the SEARCH block in the file.",
					attempted: "- [ ] step 1",
					currentBody: "- [x] step 1\n- [ ] step 2",
				},
				body: "",
			});
			assert.match(out, /Could not find the SEARCH block/);
			assert.match(out, /--- attempted ---/);
			assert.match(out, /- \[ \] step 1/);
			assert.match(out, /--- current body of known:\/\/plan ---/);
			assert.match(out, /- \[x\] step 1\n\t- \[ \] step 2/);
		});
	});

	describe("handler", () => {
		it("rejects body writes against log:// with method_not_allowed outcome", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			await plugin.handler(
				{
					body: "search results for X",
					path: "log://turn_2/set/log___turn_1/search/X",
					resultPath: "log://turn_2/set/log___turn_1/search/X",
					attributes: {
						path: "log://turn_1/search/X",
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
			store.setEntry("log://turn_1/search/X", { body: "results" });
			await plugin.handler(
				{
					body: "",
					path: "log://turn_2/set/log___turn_1/search/X",
					resultPath: "log://turn_2/set/log___turn_1/search/X",
					attributes: { path: "log://turn_1/search/X", archive: true },
				},
				{ entries: store, sequence: 2, runId: "r", loopId: "l" },
			);
			const flip = store._calls.find(
				(c) =>
					c.path === "log://turn_1/search/X" && c.visibility === "archived",
			);
			assert.ok(flip, "archive flip on log:// goes through");
		});

		it("rejects archive+index conflict with validation outcome", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			await plugin.handler(
				{
					body: "",
					path: "log://turn_1/set/known%3A//x",
					resultPath: "log://turn_1/set/known%3A//x",
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
					path: "log://turn_1/set/known%3A//missing",
					resultPath: "log://turn_1/set/known%3A//missing",
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
					path: "log://turn_1/set/known%3A//x",
					resultPath: "log://turn_1/set/known%3A//x",
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
					path: "log://turn_1/set/x",
					resultPath: "log://turn_1/set/x",
					attributes: {},
				},
				{ entries: store, sequence: 1, runId: "r", loopId: "l" },
			);
			assert.deepEqual(store._calls, []);
		});

		it("scheme write: stores resolved body + log entry with udiff patch", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			await plugin.handler(
				{
					body: "v2",
					path: "log://turn_1/set/known%3A//x",
					resultPath: "log://turn_1/set/known%3A//x",
					attributes: { path: "known://x" },
				},
				{ entries: store, sequence: 1, runId: "r", loopId: "l" },
			);
			const target = store._calls.find(
				(c) => c.path === "known://x" && c.body === "v2",
			);
			assert.ok(target);
			assert.equal(target.visibility, "indexed");
			const log = store._calls.find(
				(c) => c.path === "log://turn_1/set/known%3A//x",
			);
			assert.ok(log.attributes.patch);
		});

		it("file write (no scheme on path) issues a `proposed` log entry with patched body", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			await plugin.handler(
				{
					body: "new content",
					path: "log://turn_1/set/foo.js",
					resultPath: "log://turn_1/set/foo.js",
					attributes: { path: "src/foo.js" },
				},
				{ entries: store, sequence: 1, runId: "r", loopId: "l" },
			);
			const log = store._calls.find(
				(c) => c.path === "log://turn_1/set/foo.js",
			);
			assert.ok(log);
			assert.equal(log.state, "proposed");
			assert.equal(log.attributes.path, "src/foo.js");
			assert.equal(log.attributes.patched, "new content");
			assert.ok(log.attributes.patch);
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
			const out = await fn(existing, { path: "log://turn_1/set/x" });
			assert.strictEqual(out, existing);
		});

		it("vetoReadonly filter passes through for non-set proposals", async () => {
			const core = stubCore();
			new Set(core);
			const fn = core._get("proposal.accepting")[0];
			const out = await fn(null, { path: "log://turn_1/get/x", attrs: {} });
			assert.equal(out, null);
		});

		it("vetoReadonly filter blocks readonly file writes", async () => {
			const core = stubCore();
			new Set(core);
			const fn = core._get("proposal.accepting")[0];
			const ctx = {
				path: "log://turn_1/set/x",
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
				path: "log://turn_1/set/x",
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
				path: "log://turn_1/set/x",
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
				path: "log://turn_1/get/x",
				entries: {},
			});
			assert.equal(out, "default");
		});
	});

	describe("bare-file SEARCH/REPLACE emits a proposal (not a resolved entry)", () => {
		const editOps = [{ op: "search_replace", search: "old", replace: "new" }];

		it("successful edit on bare file yields state=proposed with attrs.path + attrs.patched", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			store.setEntry("src/app.js", {
				body: "old line",
				scheme: null,
				tokens: 2,
			});
			await plugin.handler(
				{
					body: "",
					path: "log://turn_1/set/src%2Fapp.js",
					resultPath: "log://turn_1/set/src%2Fapp.js",
					attributes: { path: "src/app.js", operations: editOps },
				},
				{ entries: store, sequence: 1, runId: "r", loopId: "l" },
			);
			const log = store._calls.find(
				(c) => c.path === "log://turn_1/set/src%2Fapp.js",
			);
			assert.ok(log);
			assert.equal(log.state, "proposed");
			assert.equal(log.attributes.path, "src/app.js");
			assert.equal(log.attributes.patched, "new line");
			assert.ok(log.attributes.patch);
		});

		it("does not write a set:// canonical entry (no detour)", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			store.setEntry("src/app.js", {
				body: "old line",
				scheme: null,
				tokens: 2,
			});
			await plugin.handler(
				{
					body: "",
					path: "log://turn_1/set/src%2Fapp.js",
					resultPath: "log://turn_1/set/src%2Fapp.js",
					attributes: { path: "src/app.js", operations: editOps },
				},
				{ entries: store, sequence: 1, runId: "r", loopId: "l" },
			);
			const canonical = store._calls.find((c) =>
				c.path?.startsWith?.("set://"),
			);
			assert.equal(canonical, undefined);
		});

		it("search_replace on a missing path is implicitly recovered as APPEND", async () => {
			// Implicit-edit recovery: model emitted SEARCH/REPLACE on a
			// path that doesn't exist yet. Engine treats it as APPEND of
			// the replace content (byte-identical to NEW on empty body)
			// rather than failing with not_found. Silent: the model's
			// natural shape for "make this edit land" works.
			const plugin = new Set(stubCore());
			const store = makeStore();
			await plugin.handler(
				{
					body: "",
					path: "log://turn_1/set/known%3A%2F%2Fnew",
					resultPath: "log://turn_1/set/known%3A%2F%2Fnew",
					attributes: {
						path: "known://new",
						operations: [
							{
								op: "search_replace",
								search: "ignored",
								replace: "fresh body",
							},
						],
					},
				},
				{ entries: store, sequence: 1, runId: "r", loopId: "l" },
			);
			const upsert = store._calls.find((c) => c.path === "known://new");
			assert.ok(upsert, "path was created");
			assert.equal(upsert.body, "fresh body");
			const log = store._calls.find(
				(c) => c.path === "log://turn_1/set/known%3A%2F%2Fnew",
			);
			assert.notEqual(log?.state, "failed", "no not_found error");
		});

		it("delete on a missing path is silently dropped", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			await plugin.handler(
				{
					body: "",
					path: "log://turn_1/set/known%3A%2F%2Fnew",
					resultPath: "log://turn_1/set/known%3A%2F%2Fnew",
					attributes: {
						path: "known://new",
						operations: [{ op: "delete", content: "anything" }],
					},
				},
				{ entries: store, sequence: 1, runId: "r", loopId: "l" },
			);
			// Delete-only on missing path → no upsert (effective ops is empty),
			// no failure either.
			const upsert = store._calls.find((c) => c.path === "known://new");
			assert.equal(upsert, undefined);
			const log = store._calls.find(
				(c) => c.path === "log://turn_1/set/known%3A%2F%2Fnew",
			);
			assert.notEqual(log?.state, "failed");
		});

		it("multi-op (search_replace + new + delete) on missing path applies in order", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			await plugin.handler(
				{
					body: "",
					path: "log://turn_1/set/known%3A%2F%2Fnew",
					resultPath: "log://turn_1/set/known%3A%2F%2Fnew",
					attributes: {
						path: "known://new",
						operations: [
							{ op: "search_replace", search: "x", replace: "alpha\n" },
							{ op: "append", content: "beta\n" },
							{ op: "delete", content: "won't apply" },
							{ op: "search_replace", search: "y", replace: "gamma\n" },
						],
					},
				},
				{ entries: store, sequence: 1, runId: "r", loopId: "l" },
			);
			const upsert = store._calls.find((c) => c.path === "known://new");
			assert.ok(upsert);
			// search_replace #1 → APPEND alpha; append beta; delete dropped;
			// search_replace #2 → APPEND gamma. Final body: alpha\nbeta\ngamma\n
			assert.equal(upsert.body, "alpha\nbeta\ngamma\n");
		});

		it("search_replace on existing path with non-matching text still conflicts", async () => {
			// Recovery only applies when path is missing entirely. An
			// existing body with a non-matching SEARCH still surfaces as
			// conflict so the model gets actionable feedback.
			const plugin = new Set(stubCore());
			const store = makeStore();
			store.setEntry("known://exists", {
				body: "actual stored content",
				scheme: "known",
				tokens: 2,
			});
			await plugin.handler(
				{
					body: "",
					path: "log://turn_1/set/known%3A%2F%2Fexists",
					resultPath: "log://turn_1/set/known%3A%2F%2Fexists",
					attributes: {
						path: "known://exists",
						operations: [
							{ op: "search_replace", search: "absent", replace: "x" },
						],
					},
				},
				{ entries: store, sequence: 1, runId: "r", loopId: "l" },
			);
			const log = store._calls.find(
				(c) => c.path === "log://turn_1/set/known%3A%2F%2Fexists",
			);
			assert.equal(log.state, "failed");
			assert.equal(log.outcome, "conflict");
		});

		it("failed edit (search not found) yields state=failed with conflict outcome", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			store.setEntry("src/app.js", {
				body: "actual content",
				scheme: null,
				tokens: 2,
			});
			await plugin.handler(
				{
					body: "",
					path: "log://turn_1/set/src%2Fapp.js",
					resultPath: "log://turn_1/set/src%2Fapp.js",
					attributes: {
						path: "src/app.js",
						operations: [
							{ op: "search_replace", search: "absent", replace: "x" },
						],
					},
				},
				{ entries: store, sequence: 1, runId: "r", loopId: "l" },
			);
			const log = store._calls.find(
				(c) => c.path === "log://turn_1/set/src%2Fapp.js",
			);
			assert.equal(log.state, "failed");
			assert.equal(log.outcome, "conflict");
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
			async getEntriesByPattern() {
				return matches;
			},
			async getBody() {
				throw new Error("manifest must not read source body");
			},
			async getState() {
				return null;
			},
			async logPath(_r, t, s, p) {
				return `log://turn_${t}/${s}/${encodeURIComponent(p)}`;
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

	it("manifest + SEARCH/REPLACE edit: lists matches without applying edit", async () => {
		const store = manifestStore(matches);
		await plugin.handler(
			{
				attributes: {
					path: "src/**/*.js",
					manifest: "",
					blocks: [{ search: "old", replace: "new" }],
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

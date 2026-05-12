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

		it("NEW emissions project verbatim (no SEARCH half to strip)", () => {
			const body = "<<NEW\nfoo\nNEW";
			const out = plugin.full({ attributes: { path: "x.js" }, body });
			assert.equal(out, "<<NEW\nfoo\nNEW");
		});

		it("SEARCH/REPLACE projects as REPLACE-only — model sees forward state, not the diff cost", () => {
			const body = "<<SEARCH\nold\nSEARCH<<REPLACE\nnew\nREPLACE";
			const out = plugin.full({ attributes: { path: "x" }, body });
			assert.equal(out, "<<REPLACE\nnew\nREPLACE");
		});

		it("multi-hunk SEARCH/REPLACE projects as ordered REPLACE blocks", () => {
			const body =
				"<<SEARCH\nold1\nSEARCH<<REPLACE\nnew1\nREPLACE<<SEARCH\nold2\nSEARCH<<REPLACE\nnew2\nREPLACE";
			const out = plugin.full({ attributes: { path: "x" }, body });
			assert.equal(out, "<<REPLACE\nnew1\nREPLACE<<REPLACE\nnew2\nREPLACE");
		});

		it("opPositions projects target-line-numbered content with preNumbered flag", () => {
			const out = plugin.full({
				attributes: {
					path: "x",
					opPositions: [
						{
							kind: "search_replace",
							startLine: 5,
							lineCount: 2,
							content: "alpha\nbeta",
						},
						{
							kind: "append",
							startLine: 42,
							lineCount: 3,
							content: "gamma\ndelta\nepsilon",
						},
					],
				},
				body: "<<SEARCH\nold\nSEARCH<<REPLACE\nalpha\nbeta\nREPLACE",
			});
			assert.deepEqual(out, {
				body: "5:\talpha\n6:\tbeta\n\n42:\tgamma\n43:\tdelta\n44:\tepsilon",
				preNumbered: true,
			});
		});

		it("opPositions with empty content (delete-only set) projects empty body", () => {
			const out = plugin.full({
				attributes: { path: "x", opPositions: [] },
				body: "<<DELETE\nfoo\nDELETE",
			});
			assert.deepEqual(out, { body: "", preNumbered: true });
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
			assert.match(out, /- \[x\] step 1\n- \[ \] step 2/);
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

		it("scheme write: stores resolved body + log entry with verbatim emission", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			await plugin.handler(
				{
					body: "v2",
					path: "log://1/1/1/set",
					resultPath: "log://1/1/1/set",
					attributes: { path: "known://x", inner: "v2" },
				},
				{ entries: store, sequence: 1, runId: "r", loopId: "l" },
			);
			const target = store._calls.find(
				(c) => c.path === "known://x" && c.body === "v2",
			);
			assert.ok(target);
			assert.equal(target.visibility, "indexed");
			const log = store._calls.find((c) => c.path === "log://1/1/1/set");
			assert.ok(log);
			assert.equal(log.body, "v2", "log body is the model's verbatim emission");
			assert.equal(log.attributes.beforeActionTokens, 0);
			assert.ok(log.attributes.afterActionTokens > 0);
			assert.ok(
				log.attributes.patch,
				"attrs.patch carries the udiff projection for client rendering",
			);
		});

		it("file write (no scheme on path) issues a `proposed` log entry with patched body", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			await plugin.handler(
				{
					body: "new content",
					path: "log://1/1/1/set",
					resultPath: "log://1/1/1/set",
					attributes: { path: "src/foo.js", inner: "new content" },
				},
				{ entries: store, sequence: 1, runId: "r", loopId: "l" },
			);
			const log = store._calls.find((c) => c.path === "log://1/1/1/set");
			assert.ok(log);
			assert.equal(log.state, "proposed");
			assert.equal(log.attributes.path, "src/foo.js");
			assert.equal(log.attributes.patched, "new content");
			assert.equal(log.body, "new content", "log body is verbatim emission");
			assert.ok(
				log.attributes.patch,
				"attrs.patch carries the udiff for client rendering",
			);
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

	// Regression: model emitted `<set path="OC_RIVERS.md" index><<NEW…</set>`
	// with both a visibility attr AND a NEW body. The visibility-flip-only
	// branch caught the empty `entry.body` (XmlParser routes content into
	// `attrs.operations`), saw the target didn't exist, failed with
	// "not_found", and silently dropped the body. The model's delivery
	// became a hallucination from our side.
	describe("regression: visibility attr + edit operations writes the body, not a not_found", () => {
		it("`<set path=X index><<NEW…NEW</set>` on a non-existing file lands as a proposal carrying the body", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			const newBody = "# Report\n\nFull contents.\n";
			await plugin.handler(
				{
					body: "",
					path: "log://1/14/1/set",
					resultPath: "log://1/14/1/set",
					attributes: {
						path: "OC_RIVERS.md",
						index: "",
						tags: "report,internal",
						operations: [{ op: "new", content: newBody }],
					},
				},
				{ entries: store, sequence: 14, runId: "r", loopId: "l" },
			);
			const log = store._calls.find((c) => c.path === "log://1/14/1/set");
			assert.ok(log, "log entry written");
			assert.notEqual(
				log.state,
				"failed",
				`expected proposed/resolved, got failed (${log.outcome}: ${log.body?.slice(0, 80)})`,
			);
			assert.equal(log.state, "proposed");
			assert.equal(log.attributes.path, "OC_RIVERS.md");
			assert.equal(log.attributes.patched, newBody);
			// The visibility hint survives onto the proposal so
			// #materializeFile can honor it at accept time.
			assert.equal(log.attributes.index, true);
		});
	});

	describe("bare-file SEARCH/REPLACE emits a proposal (not a resolved entry)", () => {
		const editOps = [
			{ op: "search_replace", search: "old line", replace: "new line" },
		];

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
					path: "log://1/1/1/set",
					resultPath: "log://1/1/1/set",
					attributes: { path: "src/app.js", operations: editOps },
				},
				{ entries: store, sequence: 1, runId: "r", loopId: "l" },
			);
			const log = store._calls.find((c) => c.path === "log://1/1/1/set");
			assert.ok(log);
			assert.equal(log.state, "proposed");
			assert.equal(log.attributes.path, "src/app.js");
			assert.equal(log.attributes.patched, "new line");
			assert.ok(
				log.attributes.patch,
				"attrs.patch carries the udiff projection for client rendering",
			);
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
					path: "log://1/1/1/set",
					resultPath: "log://1/1/1/set",
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
					path: "log://1/1/2/set",
					resultPath: "log://1/1/2/set",
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
			const log = store._calls.find((c) => c.path === "log://1/1/2/set");
			assert.notEqual(log?.state, "failed", "no not_found error");
		});

		it("delete on a missing path is silently dropped", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			await plugin.handler(
				{
					body: "",
					path: "log://1/1/2/set",
					resultPath: "log://1/1/2/set",
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
			const log = store._calls.find((c) => c.path === "log://1/1/2/set");
			assert.notEqual(log?.state, "failed");
		});

		it("multi-op (search_replace + new + delete) on missing path applies in order", async () => {
			const plugin = new Set(stubCore());
			const store = makeStore();
			await plugin.handler(
				{
					body: "",
					path: "log://1/1/2/set",
					resultPath: "log://1/1/2/set",
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
					path: "log://1/1/3/set",
					resultPath: "log://1/1/3/set",
					attributes: {
						path: "known://exists",
						operations: [
							{ op: "search_replace", search: "absent", replace: "x" },
						],
					},
				},
				{ entries: store, sequence: 1, runId: "r", loopId: "l" },
			);
			const log = store._calls.find((c) => c.path === "log://1/1/3/set");
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
					path: "log://1/1/1/set",
					resultPath: "log://1/1/1/set",
					attributes: {
						path: "src/app.js",
						operations: [
							{ op: "search_replace", search: "absent", replace: "x" },
						],
					},
				},
				{ entries: store, sequence: 1, runId: "r", loopId: "l" },
			);
			const log = store._calls.find((c) => c.path === "log://1/1/1/set");
			assert.equal(log.state, "failed");
			assert.equal(log.outcome, "conflict");
		});

		// Scoped SEARCH/REPLACE: model authors `<<SEARCH[X]…SEARCH[Y]<<REPLACE…REPLACE`
		// against the line numbers it sees in projection. The scope makes the
		// match positional (uniqueness no longer depends on the SEARCH content
		// being unique in the file), and the content stays as a verification
		// check on top of the position.
		describe("scoped SEARCH/REPLACE (line-targeted)", () => {
			const fileBody = "line1\nline2\nold A\nold B\nold C\nline6\n";
			async function run(operations) {
				const plugin = new Set(stubCore());
				const store = makeStore();
				store.setEntry("src/app.js", {
					body: fileBody,
					scheme: null,
					tokens: 2,
				});
				await plugin.handler(
					{
						body: "",
						path: "log://1/1/1/set",
						resultPath: "log://1/1/1/set",
						attributes: { path: "src/app.js", operations },
					},
					{ entries: store, sequence: 1, runId: "r", loopId: "l" },
				);
				return store;
			}

			it("scoped replace with content verification applies cleanly", async () => {
				const store = await run([
					{
						op: "search_replace",
						scope: { start: 3, end: 5 },
						search: "old A\nold B\nold C",
						replace: "new A\nnew B\nnew C",
					},
				]);
				const log = store._calls.find((c) => c.path === "log://1/1/1/set");
				assert.equal(log.state, "proposed");
				assert.equal(
					log.attributes.patched,
					"line1\nline2\nnew A\nnew B\nnew C\nline6\n",
				);
				assert.deepEqual(log.attributes.opPositions, [
					{
						kind: "search_replace",
						startLine: 3,
						lineCount: 3,
						content: "new A\nnew B\nnew C",
					},
				]);
				assert.equal(
					log.attributes.op,
					"search_replace",
					"op envelope attr surfaces the operative intent",
				);
			});

			it("multi-op set: op attr is comma-separated kind list (incl. delete)", async () => {
				const store = await run([
					{
						op: "search_replace",
						scope: { start: 3, end: 3 },
						search: "old A",
						replace: "new A",
					},
					{ op: "append", content: "appended line" },
					{ op: "delete", content: "line2" },
				]);
				const log = store._calls.find((c) => c.path === "log://1/1/1/set");
				assert.equal(
					log.attributes.op,
					"search_replace,append,delete",
					"every op kind surfaces in order, including delete (which has no opPositions entry)",
				);
			});

			it("scoped single-line replace (start == end)", async () => {
				const store = await run([
					{
						op: "search_replace",
						scope: { start: 4, end: 4 },
						search: "old B",
						replace: "REPLACED B",
					},
				]);
				const log = store._calls.find((c) => c.path === "log://1/1/1/set");
				assert.equal(log.state, "proposed");
				assert.equal(
					log.attributes.patched,
					"line1\nline2\nold A\nREPLACED B\nold C\nline6\n",
				);
			});

			it("empty SEARCH body is the trust-the-numbers form (undocumented)", async () => {
				const store = await run([
					{
						op: "search_replace",
						scope: { start: 3, end: 5 },
						search: "",
						replace: "X\nY\nZ",
					},
				]);
				const log = store._calls.find((c) => c.path === "log://1/1/1/set");
				assert.equal(log.state, "proposed");
				assert.equal(log.attributes.patched, "line1\nline2\nX\nY\nZ\nline6\n");
			});

			it("content mismatch at the scoped range fails with conflict + actual lines feedback", async () => {
				const store = await run([
					{
						op: "search_replace",
						scope: { start: 3, end: 5 },
						search: "WRONG\nWRONG\nWRONG",
						replace: "x",
					},
				]);
				const log = store._calls.find((c) => c.path === "log://1/1/1/set");
				assert.equal(log.state, "failed");
				assert.equal(log.outcome, "conflict");
				assert.match(
					log.attributes.error,
					/SEARCH\[3-5\] content does not match/,
				);
				// Conflict body carries the actual lines at that range so the
				// model can author a correct delta on the next turn.
				assert.equal(log.attributes.currentBody, "old A\nold B\nold C");
			});

			it("out-of-range scope fails with the current line count in the error", async () => {
				const store = await run([
					{
						op: "search_replace",
						scope: { start: 50, end: 60 },
						search: "",
						replace: "x",
					},
				]);
				const log = store._calls.find((c) => c.path === "log://1/1/1/set");
				assert.equal(log.state, "failed");
				assert.equal(log.outcome, "conflict");
				assert.match(log.attributes.error, /out of range/);
			});

			it("REPLACE may shrink or grow the line range (insert-extra / delete-some)", async () => {
				const store = await run([
					{
						op: "search_replace",
						scope: { start: 3, end: 5 },
						search: "",
						replace: "only one line",
					},
				]);
				const log = store._calls.find((c) => c.path === "log://1/1/1/set");
				assert.equal(log.state, "proposed");
				// 3 lines replaced by 1 → body shortens.
				assert.equal(
					log.attributes.patched,
					"line1\nline2\nonly one line\nline6\n",
				);
			});
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

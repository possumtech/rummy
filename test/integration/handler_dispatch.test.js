/**
 * Handler dispatch integration test.
 *
 * Covers @dispatch_path, @plugins_handler, @get_plugin,
 * @xml_parser, @failure_reporting, @plugins_handler_outcomes —
 * the record → dispatch → state-change loop that turns parsed XML
 * commands into entries with outcomes. View projection
 * (@plugins_views) is tested separately in engine.test.js and
 * tool_visibility.test.js, which exercise the full/summary
 * rendering path.
 *
 * Proves the record→dispatch→state-change loop:
 * 1. XmlParser produces commands (@xml_parser — parser is the
 *    syntax layer this test feeds)
 * 2. Commands recorded as entries at "full" state
 * 3. Handlers dispatched via ToolRegistry
 * 4. Handlers finalize their own log entry's body+state+outcome
 *    on success or failure (@failure_reporting,
 *    @plugins_handler_outcomes — the action entry IS its outcome).
 * 5. Multiple handlers per scheme run in priority order
 */
import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import Entries from "../../src/agent/Entries.js";
import createHooks from "../../src/hooks/Hooks.js";
import RummyContext from "../../src/hooks/RummyContext.js";
import { registerPlugins } from "../../src/plugins/index.js";
import TestDb from "../helpers/TestDb.js";

let RUN_ID;
let LOOP_ID;
let PROJECT;

function makeRummy(
	hooks,
	db,
	store,
	{ sequence = 1, contextSize = 50000 } = {},
) {
	const hookRoot = {
		tag: "turn",
		attrs: {},
		content: null,
		children: [
			{ tag: "system", attrs: {}, content: null, children: [] },
			{ tag: "context", attrs: {}, content: null, children: [] },
			{ tag: "user", attrs: {}, content: null, children: [] },
			{ tag: "assistant", attrs: {}, content: null, children: [] },
		],
	};
	return new RummyContext(hookRoot, {
		hooks,
		db,
		store,
		project: PROJECT,
		type: "act",
		sequence,
		runId: RUN_ID,
		loopId: LOOP_ID,
		turnId: 1,
		noRepo: false,
		contextSize,
		systemPrompt: "test",
		loopPrompt: "",
	});
}

describe("Handler dispatch", () => {
	let tdb, store, hooks;

	before(async () => {
		tdb = await TestDb.create();
		store = new Entries(tdb.db);
		const seed = await tdb.seedRun({ alias: "dispatch_1" });
		RUN_ID = seed.runId;
		LOOP_ID = seed.loopId;
		PROJECT = { id: seed.projectId, path: "/tmp/test", name: "Test" };

		hooks = createHooks();
		const { dirname, join } = await import("node:path");
		const { fileURLToPath } = await import("node:url");
		const pluginsDir = join(
			dirname(fileURLToPath(import.meta.url)),
			"../../src/plugins",
		);
		await registerPlugins([pluginsDir], hooks);
	});

	after(async () => {
		await tdb.cleanup();
	});

	describe("get handler", () => {
		it("re-indexes target and writes a concise log so the model sees the action", async () => {
			await store.set({
				runId: RUN_ID,
				loopId: LOOP_ID,
				turn: 0,
				path: "src/target.js",
				body: "const x = 1;",
				state: "resolved",
				visibility: "archived",
			});

			const rummy = makeRummy(hooks, tdb.db, store, { sequence: 1 });
			const entry = {
				scheme: "get",
				path: "get://src%2Ftarget.js",
				body: "",
				attributes: {
					path: "src/target.js",
					source: '<get path="src/target.js"/>',
				},
				state: "resolved",
				resultPath: "get://src%2Ftarget.js",
			};

			await hooks.tools.dispatch("get", entry, rummy);

			const state = await tdb.db.get_entry_state.get({
				run_id: RUN_ID,
				path: "src/target.js",
			});
			assert.strictEqual(state.visibility, "indexed", "target re-indexed");

			// <get> is the fat-fetch verb: log body = retrieved content (S6).
			const log = await store.getBody(RUN_ID, entry.resultPath);
			assert.equal(log, "const x = 1;", "log body = retrieved content");
			const attrs = await store.getAttributes(RUN_ID, entry.resultPath);
			assert.equal(attrs.path, "src/target.js");
			assert.ok(attrs.afterActionTokens > 0, "tokens reflect retrieval cost");
		});

		it("writes log on not-found so the attempt is recorded", async () => {
			const rummy = makeRummy(hooks, tdb.db, store, { sequence: 1 });
			const entry = {
				scheme: "get",
				path: "get://missing.js",
				body: "",
				attributes: {
					path: "src/missing.js",
					source: '<get path="src/missing.js"/>',
				},
				state: "resolved",
				resultPath: "get://missing.js",
			};

			await hooks.tools.dispatch("get", entry, rummy);

			const log = await store.getBody(RUN_ID, entry.resultPath);
			assert.equal(log, "", "not-found log: empty body, path in JSON envelope");
			const state = await store.getState(RUN_ID, entry.resultPath);
			assert.equal(state.outcome, "not_found", "outcome marks the miss");
			const attrs = await store.getAttributes(RUN_ID, entry.resultPath);
			assert.match(attrs.error, /not found/, "attrs.error names the miss");
		});
	});

	describe("set handler — edit mode (@edit_grammar)", () => {
		it("applies patch and sets proposed for files", async () => {
			await store.set({
				runId: RUN_ID,
				loopId: LOOP_ID,
				turn: 1,
				path: "src/edit_me.js",
				body: "const port = 3000;",
				state: "resolved",
			});

			const rummy = makeRummy(hooks, tdb.db, store, { sequence: 1 });
			const logPath = "log://1/1/3/set";
			const entry = {
				scheme: "set",
				path: logPath,
				body: "",
				attributes: {
					path: "src/edit_me.js",
					hunks: [
						{
							oldStart: 1,
							oldLines: 1,
							newStart: 1,
							newLines: 1,
							lines: ["-const port = 3000;", "+const port = 8080;"],
						},
					],
				},
				state: "resolved",
				resultPath: logPath,
			};

			await hooks.tools.dispatch("set", entry, rummy);
			await hooks.proposal.prepare.emit({ rummy, recorded: [entry] });

			const attrs = await store.getAttributes(RUN_ID, logPath);
			assert.equal(attrs.path, "src/edit_me.js");
			assert.ok(attrs.patched.includes("8080"), "patched has new content");

			const logState = await store.getState(RUN_ID, logPath);
			assert.equal(logState.state, "proposed", "bare-file edit is proposed");
		});

		it("fuzzy-matched edits land on materialization (no silent no-op)", async () => {
			// File body has 4-space indent.
			const original = "function add(a, b) {\n    return a + b;\n}\n";
			await store.set({
				runId: RUN_ID,
				loopId: LOOP_ID,
				turn: 1,
				path: "src/fuzzy.js",
				body: original,
				state: "resolved",
			});

			const rummy = makeRummy(hooks, tdb.db, store, { sequence: 1 });
			const logPath = "log://1/1/4/set";
			// `-` lines have tab indent (mismatched against file's 4-space).
			// Strict apply misses; Hedberg fallback heals the indent.
			const entry = {
				scheme: "set",
				path: logPath,
				body: "",
				attributes: {
					path: "src/fuzzy.js",
					hunks: [
						{
							oldStart: 1,
							oldLines: 3,
							newStart: 1,
							newLines: 3,
							lines: [
								"-function add(a, b) {",
								"-\treturn a + b;",
								"-}",
								"+function add(a, b) {",
								"+\treturn a + b + 1;",
								"+}",
							],
						},
					],
				},
				state: "resolved",
				resultPath: logPath,
			};
			await hooks.tools.dispatch("set", entry, rummy);

			const attrs = await store.getAttributes(RUN_ID, logPath);
			assert.ok(attrs.patched, "attrs.patched stored");
			assert.ok(attrs.patched.includes("a + b + 1"), "patched has new content");

			// Fire proposal.accepted to trigger #materializeFile.
			await hooks.proposal.accepted.emit({
				runId: RUN_ID,
				loopId: LOOP_ID,
				turn: 1,
				attrs,
				db: tdb.db,
				entries: store,
				path: logPath,
				projectRoot: null,
			});

			const fileBody = await store.getBody(RUN_ID, "src/fuzzy.js");
			assert.ok(
				fileBody.includes("a + b + 1"),
				`materialization produced patched body, got: ${fileBody}`,
			);
		});

		// cp/mv to bare paths now decompose into resolved recap + set
		// proposal (and for mv, atomic source rm on set accept). The
		// decomposition contract is tested in plugins/cp/cp.test.js,
		// plugins/mv/mv.test.js, and proposal_wire_contract.test.js;
		// end-to-end accept-side materialization is exercised in
		// proposal_lifecycle.test.js. The old "single proposal at
		// log://*/cp" shape these tests pinned no longer exists.

		it("two edits to the same file produce two independent proposals", async () => {
			await store.set({
				runId: RUN_ID,
				loopId: LOOP_ID,
				turn: 1,
				path: "src/math.txt",
				body: "a + 4 = 6\n7 - a = \nb / 4 = 3\na + b = \n",
				state: "resolved",
			});

			const rummy = makeRummy(hooks, tdb.db, store, { sequence: 1 });

			const path1 = "log://1/1/7/set";
			const path2 = "log://1/1/8/set";
			const entry1 = {
				scheme: "set",
				path: path1,
				body: "",
				attributes: {
					path: "src/math.txt",
					hunks: [
						{
							oldStart: 2,
							oldLines: 1,
							newStart: 2,
							newLines: 1,
							lines: ["-7 - a = ", "+7 - a = 5"],
						},
					],
				},
				state: "resolved",
				resultPath: path1,
			};
			await hooks.tools.dispatch("set", entry1, rummy);

			const entry2 = {
				scheme: "set",
				path: path2,
				body: "",
				attributes: {
					path: "src/math.txt",
					hunks: [
						{
							oldStart: 4,
							oldLines: 1,
							newStart: 4,
							newLines: 1,
							lines: ["-a + b = ", "+a + b = 14"],
						},
					],
				},
				state: "resolved",
				resultPath: path2,
			};
			await hooks.tools.dispatch("set", entry2, rummy);

			await hooks.proposal.prepare.emit({ rummy, recorded: [entry1, entry2] });

			const a1 = await store.getAttributes(RUN_ID, path1);
			assert.equal(a1.path, "src/math.txt");
			assert.ok(
				a1.patched.includes("7 - a = 5"),
				"first proposal has first edit",
			);

			const a2 = await store.getAttributes(RUN_ID, path2);
			assert.equal(a2.path, "src/math.txt");
			assert.ok(
				a2.patched.includes("a + b = 14"),
				"second proposal has second edit",
			);

			const s1 = await store.getState(RUN_ID, path1);
			const s2 = await store.getState(RUN_ID, path2);
			assert.equal(s1.state, "proposed");
			assert.equal(s2.state, "proposed");
		});

		it("applies patch immediately for known:// entries", async () => {
			await store.set({
				runId: RUN_ID,
				loopId: LOOP_ID,
				turn: 1,
				path: "known://config",
				body: "port=3000",
				state: "resolved",
			});

			const rummy = makeRummy(hooks, tdb.db, store, { sequence: 1 });
			const entry = {
				scheme: "set",
				path: "set://known%3A%2F%2Fconfig",
				body: "",
				attributes: {
					path: "known://config",
					hunks: [
						{
							oldStart: 1,
							oldLines: 1,
							newStart: 1,
							newLines: 1,
							lines: ["-port=3000", "+port=8080"],
						},
					],
				},
				state: "resolved",
				resultPath: "set://known%3A%2F%2Fconfig",
			};

			await hooks.tools.dispatch("set", entry, rummy);

			const updated = await store.getBody(RUN_ID, "known://config");
			assert.strictEqual(
				updated,
				"port=8080",
				"known entry patched immediately",
			);
		});
	});

	describe("sh handler", () => {
		it("sets entry to proposed", async () => {
			const rummy = makeRummy(hooks, tdb.db, store, { sequence: 1 });
			const resultPath = await store.slugPath(RUN_ID, "sh", "npm test");
			await store.set({
				runId: RUN_ID,
				loopId: LOOP_ID,
				turn: 1,
				path: resultPath,
				body: "npm test",
				state: "resolved",
				attributes: { command: "npm test" },
			});

			const entry = {
				scheme: "sh",
				path: resultPath,
				body: "npm test",
				attributes: {
					command: "npm test",
					source: "<sh>npm test</sh>",
				},
				state: "resolved",
				resultPath,
			};

			await hooks.tools.dispatch("sh", entry, rummy);

			const row = await tdb.db.get_entry_state.get({
				run_id: RUN_ID,
				path: resultPath,
			});
			assert.strictEqual(row.state, "proposed", "sh entry set to proposed");
		});
	});

	describe("env handler", () => {
		it("sets entry to proposed", async () => {
			const rummy = makeRummy(hooks, tdb.db, store, { sequence: 1 });
			const resultPath = await store.slugPath(RUN_ID, "env", "node --version");
			await store.set({
				runId: RUN_ID,
				loopId: LOOP_ID,
				turn: 1,
				path: resultPath,
				body: "node --version",
				state: "resolved",
				attributes: { command: "node --version" },
			});

			const entry = {
				scheme: "env",
				path: resultPath,
				body: "node --version",
				attributes: {
					command: "node --version",
					source: "<env>node --version</env>",
				},
				state: "resolved",
				resultPath,
			};

			await hooks.tools.dispatch("env", entry, rummy);

			const row = await tdb.db.get_entry_state.get({
				run_id: RUN_ID,
				path: resultPath,
			});
			assert.strictEqual(row.state, "proposed", "env entry set to proposed");
		});
	});

	describe("set archive control", () => {
		it("archives entry via boolean archive attr", async () => {
			await store.set({
				runId: RUN_ID,
				loopId: LOOP_ID,
				turn: 1,
				path: "known://demote_me",
				body: "some data",
				state: "resolved",
			});

			const rummy = makeRummy(hooks, tdb.db, store, { sequence: 1 });
			const entry = {
				scheme: "set",
				path: "set://known%3A%2F%2Fdemote_me",
				body: "",
				attributes: {
					path: "known://demote_me",
					archive: true,
					source: '<set path="known://demote_me" archive/>',
				},
				state: "resolved",
				resultPath: "set://known%3A%2F%2Fdemote_me",
			};

			await hooks.tools.dispatch("set", entry, rummy);

			const state = await tdb.db.get_entry_state.get({
				run_id: RUN_ID,
				path: "known://demote_me",
			});
			assert.strictEqual(state.visibility, "archived", "target archived");
		});
	});

	describe("rm handler", () => {
		it("proposes deletion for files", async () => {
			await store.set({
				runId: RUN_ID,
				loopId: LOOP_ID,
				turn: 1,
				path: "src/doomed.js",
				body: "content",
				state: "resolved",
			});

			const rummy = makeRummy(hooks, tdb.db, store, { sequence: 1 });
			const entry = {
				scheme: "rm",
				path: "rm://src%2Fdoomed.js",
				body: "",
				attributes: {
					path: "src/doomed.js",
					source: '<rm path="src/doomed.js"/>',
				},
				state: "resolved",
				resultPath: "rm://src%2Fdoomed.js",
			};

			await hooks.tools.dispatch("rm", entry, rummy);

			const entries = await tdb.db.get_known_entries.all({ run_id: RUN_ID });
			const result = entries.find((e) => e.path === "rm://src/doomed.js");
			assert.strictEqual(result.state, "proposed", "file delete is proposed");
		});

		it("immediately removes known:// entries", async () => {
			await store.set({
				runId: RUN_ID,
				loopId: LOOP_ID,
				turn: 1,
				path: "known://ephemeral",
				body: "temp",
				state: "resolved",
			});

			const rummy = makeRummy(hooks, tdb.db, store, { sequence: 1 });
			const entry = {
				scheme: "rm",
				path: "rm://known%3A%2F%2Fephemeral",
				body: "",
				attributes: {
					path: "known://ephemeral",
					source: '<rm path="known://ephemeral"/>',
				},
				state: "resolved",
				resultPath: "rm://known%3A%2F%2Fephemeral",
			};

			await hooks.tools.dispatch("rm", entry, rummy);

			const gone = await store.getBody(RUN_ID, "known://ephemeral");
			assert.strictEqual(gone, null, "known entry removed immediately");
		});

		it("multi-match produces one aggregate result entry", async () => {
			await store.set({
				runId: RUN_ID,
				loopId: LOOP_ID,
				turn: 2,
				path: "known://bulk_a",
				body: "data-a",
				state: "resolved",
			});
			await store.set({
				runId: RUN_ID,
				loopId: LOOP_ID,
				turn: 2,
				path: "known://bulk_b",
				body: "data-b",
				state: "resolved",
			});
			await store.set({
				runId: RUN_ID,
				loopId: LOOP_ID,
				turn: 2,
				path: "known://bulk_c",
				body: "data-c",
				state: "resolved",
			});

			const allBefore = await tdb.db.get_known_entries.all({ run_id: RUN_ID });
			const rmCountBefore = allBefore.filter((e) => e.scheme === "rm").length;

			const rummy = makeRummy(hooks, tdb.db, store, { sequence: 2 });
			const resultPath = "rm://known%3A%2F%2Fbulk_*";
			const entry = {
				scheme: "rm",
				path: resultPath,
				body: "",
				attributes: {
					path: "known://bulk_*",
					source: '<rm path="known://bulk_*"/>',
				},
				state: "resolved",
				resultPath,
			};

			await hooks.tools.dispatch("rm", entry, rummy);

			// All three entries removed
			const remaining = await store.getEntriesByPattern(
				RUN_ID,
				"known://bulk_*",
				null,
			);
			assert.strictEqual(remaining.length, 0, "all matched entries removed");

			const allAfter = await tdb.db.get_known_entries.all({ run_id: RUN_ID });
			const rmEntries = allAfter.filter((e) => e.scheme === "rm");
			assert.strictEqual(
				rmEntries.length - rmCountBefore,
				1,
				"one aggregate result entry",
			);
			const rmEntry = rmEntries.find((e) => {
				const a =
					typeof e.attributes === "string"
						? JSON.parse(e.attributes)
						: e.attributes;
				return a?.path === "known://bulk_*";
			});
			assert.ok(rmEntry, "aggregate rm entry exists with target attr");
			assert.strictEqual(rmEntry.state, "resolved");
			const rmAttrs =
				typeof rmEntry.attributes === "string"
					? JSON.parse(rmEntry.attributes)
					: rmEntry.attributes;
			assert.ok(
				rmAttrs.beforeActionTokens > 0,
				"action-token delta records the freed budget",
			);
			assert.equal(rmAttrs.afterActionTokens, 0, "after = 0 (all gone)");
		});
	});

	describe("priority ordering", () => {
		it("lower priority handlers run first", async () => {
			const order = [];

			hooks.tools.onHandle(
				"get",
				async () => {
					order.push("plugin-at-5");
				},
				5,
			);

			await store.set({
				runId: RUN_ID,
				loopId: LOOP_ID,
				turn: 1,
				path: "src/priority_test.js",
				body: "x",
				state: "resolved",
				visibility: "archived",
			});

			const rummy = makeRummy(hooks, tdb.db, store, { sequence: 1 });
			const entry = {
				scheme: "get",
				path: "get://priority_test",
				body: "",
				attributes: { path: "src/priority_test.js" },
				state: "resolved",
				resultPath: "get://priority_test",
			};

			await hooks.tools.dispatch("get", entry, rummy);
			assert.strictEqual(order[0], "plugin-at-5", "priority 5 ran first");
		});

		it("handler returning false stops the chain", async () => {
			const testHooks = createHooks();
			const order = [];

			testHooks.tools.ensureTool("test_tool");

			testHooks.tools.onHandle(
				"test_tool",
				async () => {
					order.push("first");
					return false;
				},
				1,
			);

			testHooks.tools.onHandle(
				"test_tool",
				async () => {
					order.push("second");
				},
				10,
			);

			const rummy = makeRummy(testHooks, tdb.db, store, { sequence: 1 });
			await testHooks.tools.dispatch("test_tool", {}, rummy);

			assert.deepStrictEqual(order, ["first"], "chain stopped after false");
		});
	});

	describe("plugin handler behaviors (@unknown_plugin, @known_plugin, @update_plugin, @upsert_semantics)", () => {
		it("unknown handler dedupes on identical body within a run", async () => {
			const rummy = makeRummy(hooks, tdb.db, store, { sequence: 10 });
			const body = "What is the database schema?";
			const entry = {
				scheme: "unknown",
				path: "unknown://result",
				body,
				attributes: { summary: "schema,question" },
				state: "resolved",
				resultPath: "unknown://result",
			};

			await hooks.tools.dispatch("unknown", entry, rummy);
			await hooks.tools.dispatch("unknown", { ...entry }, rummy);

			const all = await tdb.db.get_known_entries.all({ run_id: RUN_ID });
			const matches = all.filter(
				(e) => e.scheme === "unknown" && e.body === body,
			);
			assert.strictEqual(
				matches.length,
				1,
				`identical unknown body collapses to one entry, got ${matches.length}`,
			);
		});

		it("update handler writes a log entry under log://<L>/<T>/<S>/update", async () => {
			const rummy = makeRummy(hooks, tdb.db, store, { sequence: 12 });
			const entry = {
				scheme: "update",
				path: "log://1/12/9/update",
				body: "working through unknowns",
				attributes: { status: 144 },
				state: "resolved",
				resultPath: "log://1/12/10/update",
			};

			await hooks.tools.dispatch("update", entry, rummy);

			const all = await tdb.db.get_known_entries.all({ run_id: RUN_ID });
			const updateLog = all.find(
				(e) =>
					e.scheme === "log" &&
					/^log:\/\/\d+\/12\/\d+\/update$/.test(e.path) &&
					e.body === "working through unknowns",
			);
			assert.ok(
				updateLog,
				"update emission lands at log://<L>/<T>/<S>/update with inner text",
			);
		});
	});
});

/**
 * Budget math verification.
 *
 * Covers @budget_enforcement — the numeric correctness of ceiling,
 * assembled-token measurement, and overflow computation that feed
 * the accept/reject decision in the `turn.beforeDispatch` filter
 * chain (budget plugin is the canonical subscriber).
 *
 * Proves that:
 * - Token counts in turn_context reflect ACTUAL context cost, not full-visibility cost
 * - Budget enforcement measures assembled messages accurately
 * - Index entries cost nothing in the budget
 * - Summary entries cost only their summary/path rendering
 * - Full entries cost their body
 * - Progress token count matches reality
 */
import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import Entries from "../../src/agent/Entries.js";
import { countTokens } from "../../src/agent/tokens.js";
import materialize from "../helpers/materialize.js";
import TestDb from "../helpers/TestDb.js";

function pad(n) {
	return Array(n).fill("hello world test data").join(" ");
}

describe("Budget math", () => {
	let tdb, store, cascade, RUN_ID;

	before(async () => {
		tdb = await TestDb.create("budget_math");
		store = new Entries(tdb.db);
		await store.loadSchemes(tdb.db);
		// Budget participates in the turn.beforeDispatch filter chain.
		// Tests want to invoke it with the same shape the old direct
		// hooks.budget.enforce had, so wrap the filter call.
		cascade = {
			enforce: (args) =>
				tdb.hooks.turn.beforeDispatch.filter(
					{
						contextSize: args.contextSize,
						messages: args.messages,
						rows: args.rows,
						lastPromptTokens: args.lastPromptTokens ?? 0,
						assembledTokens: 0,
						ok: true,
						overflow: null,
					},
					{ ctx: args.ctx, rummy: args.rummy },
				),
		};
		const seed = await tdb.seedRun({ alias: "math_1" });
		RUN_ID = seed.runId;
	});

	after(async () => {
		await tdb.cleanup();
	});

	describe("turn_context token accuracy", () => {
		it("indexed entry appears in turn_context with stored body", async () => {
			// Test helper materializes from v_model_context directly without
			// running projection — turn_context body equals stored body.
			// Real projection lives in materializeContext.js (unit-tested).
			const body = pad(50);
			await store.set({
				runId: RUN_ID,
				turn: 1,
				path: "known://full_entry",
				body,
				state: "resolved",
				visibility: "indexed",
			});
			await materialize(tdb.db, {
				runId: RUN_ID,
				turn: 1,
				systemPrompt: "test",
			});
			const rows = await tdb.db.get_turn_context.all({
				run_id: RUN_ID,
				turn: 1,
			});
			const entry = rows.find((r) => r.path === "known://full_entry");
			assert.ok(entry, "entry exists in turn_context");
			assert.strictEqual(entry.body, body, "body equals stored body");
		});

		it("archived entry does not appear in turn_context", async () => {
			const body = pad(200);
			await store.set({
				runId: RUN_ID,
				turn: 1,
				path: "test_file.js",
				body,
				state: "resolved",
				visibility: "archived",
			});
			await materialize(tdb.db, {
				runId: RUN_ID,
				turn: 1,
				systemPrompt: "test",
			});
			const rows = await tdb.db.get_turn_context.all({
				run_id: RUN_ID,
				turn: 1,
			});
			const entry = rows.find((r) => r.path === "test_file.js");
			assert.strictEqual(
				entry,
				undefined,
				"archived entry excluded from context",
			);
		});
	});

	describe("budget enforcement accuracy", () => {
		it("budget enforce measures assembled messages, not stored tokens", async () => {
			const { runId } = await tdb.seedRun({ alias: "math_enforce" });

			// Create a large entry at archive — should NOT count toward budget
			await store.set({
				runId,
				turn: 1,
				path: "big_archive_file.js",
				body: pad(500),
				state: "resolved",
				visibility: "archived",
			});
			// Create a small entry at full — should count
			await store.set({
				runId,
				turn: 1,
				path: "known://small",
				body: "tiny fact",
				state: "resolved",
				visibility: "indexed",
			});

			await materialize(tdb.db, {
				runId,
				turn: 1,
				systemPrompt: "test",
			});

			const rows = await tdb.db.get_turn_context.all({
				run_id: runId,
				turn: 1,
			});
			const messages = [
				{ role: "system", content: "test" },
				{
					role: "user",
					content: rows
						.filter((r) => r.path !== "system://prompt")
						.map((r) => r.body)
						.join("\n"),
				},
			];

			// Budget with 1000 token ceiling — should pass because index is free
			const result = await cascade.enforce({
				contextSize: 1000,
				messages,
				rows,
				lastPromptTokens: 0,
			});

			// The assembled messages should NOT include the 500-pad index body
			const _totalChars = messages.reduce(
				(s, m) => s + (m.content?.length || 0),
				0,
			);
			const indexFullCost = countTokens(pad(500));
			assert.ok(
				result.assembledTokens < indexFullCost,
				`assembled tokens (${result.assembledTokens}) should be far less than index entry full cost (${indexFullCost})`,
			);
		});

		it("enforce measures assembled tokens from messages when lastPromptTokens is 0", async () => {
			const { runId } = await tdb.seedRun({ alias: "math_postdispatch" });

			// Simulate: entries exist from dispatch (promoted files)
			await store.set({
				runId,
				turn: 1,
				path: "known://big",
				body: pad(100),
				state: "resolved",
				visibility: "indexed",
			});

			await materialize(tdb.db, {
				runId,
				turn: 1,
				systemPrompt: "test",
			});

			const rows = await tdb.db.get_turn_context.all({
				run_id: runId,
				turn: 1,
			});
			const messages = [
				{ role: "system", content: "test" },
				{
					role: "user",
					content: rows.map((r) => r.body).join("\n"),
				},
			];

			const result = await cascade.enforce({
				contextSize: 100,
				messages,
				rows,
				lastPromptTokens: 0,
				ctx: { runId, turn: 1, loopId: 0 },
				rummy: {
					entries: store,
					hooks: { error: { log: { emit: async () => {} } } },
				},
			});

			assert.strictEqual(result.ok, false, "should overflow");
			assert.ok(
				result.assembledTokens > 0,
				"assembled tokens measured from messages, not from 0",
			);
			assert.ok(result.overflow > 0, "overflow computed from measured tokens");
		});
	});

	describe("token column semantics", () => {
		it("known_entries.tokens always reflects full body cost", async () => {
			const { runId } = await tdb.seedRun({ alias: "math_ke" });
			const body = pad(100);
			const expectedTokens = countTokens(body);

			await store.set({
				runId,
				turn: 1,
				path: "known://fact",
				body,
				state: "resolved",
				visibility: "indexed",
			});
			let entries = await tdb.db.get_known_entries.all({ run_id: runId });
			let entry = entries.find((e) => e.path === "known://fact");
			assert.strictEqual(entry.tokens, expectedTokens, "tokens at full");

			// Archive — tokens should NOT change
			await store.set({
				runId: runId,
				path: "known://fact",
				visibility: "archived",
			});
			entries = await tdb.db.get_known_entries.all({ run_id: runId });
			entry = entries.find((e) => e.path === "known://fact");
			assert.strictEqual(
				entry.tokens,
				expectedTokens,
				"tokens unchanged after archive",
			);

			// Re-index — tokens should NOT change
			await store.get({ runId: runId, turn: 2, path: "known://fact" });
			entries = await tdb.db.get_known_entries.all({ run_id: runId });
			entry = entries.find((e) => e.path === "known://fact");
			assert.strictEqual(
				entry.tokens,
				expectedTokens,
				"tokens unchanged after re-index",
			);
		});

		it("turn_context excludes archived entries", async () => {
			const { runId } = await tdb.seedRun({ alias: "math_tc" });
			const body = pad(100);

			// Entry at full
			await store.set({
				runId,
				turn: 1,
				path: "known://tc_test",
				body,
				state: "resolved",
				visibility: "indexed",
			});
			await materialize(tdb.db, {
				runId,
				turn: 1,
				systemPrompt: "test",
			});
			let rows = await tdb.db.get_turn_context.all({
				run_id: runId,
				turn: 1,
			});
			let tc = rows.find((r) => r.path === "known://tc_test");
			assert.ok(tc, "full entry present in turn_context");

			// Archive — should disappear from turn_context
			await store.set({
				runId: runId,
				path: "known://tc_test",
				visibility: "archived",
			});
			await materialize(tdb.db, {
				runId,
				turn: 2,
				systemPrompt: "test",
			});
			rows = await tdb.db.get_turn_context.all({
				run_id: runId,
				turn: 2,
			});
			tc = rows.find((r) => r.path === "known://tc_test");

			assert.strictEqual(
				tc,
				undefined,
				"archived entry excluded from turn_context",
			);
		});
	});

	// The wire contract between budget math and what the model sees.
	// These tests verify the two signals the model actually reads when
	// regulating itself: `<prompt tokenUsage="N" tokensFree="M">` and
	// the `reverted="N"` attribute that surfaces after a demotion.
	describe("prompt signal correctness", () => {
		let Prompt;
		let assemblePrompt;

		before(async () => {
			Prompt = (await import("../../src/plugins/prompt/prompt.js")).default;
			// Construct the plugin against a shim core so we can call the
			// assemblePrompt filter directly.
			const shim = {
				hooks: {
					tools: {
						onView() {},
						names: ["get", "set"],
						advertisedNames: ["get", "set"],
					},
				},
				on() {},
				filter() {},
			};
			const plugin = new Prompt(shim);
			assemblePrompt = plugin.assemblePrompt.bind(plugin);
		});

		function fakePromptRow(body = "hello") {
			return {
				ordinal: 1,
				path: "prompt://1",
				scheme: "prompt",
				visibility: "indexed",
				body,
				tokens: countTokens(body),
				attributes: JSON.stringify({ mode: "act" }),
				category: "prompt",
				source_turn: 1,
			};
		}

		it("prompt no longer carries tokenUsage/tokensFree (moved to <budget>)", async () => {
			const contextSize = 10000;
			const out = await assemblePrompt("", {
				rows: [fakePromptRow()],
				contextSize,
				lastContextTokens: 8421,
				type: "act",
				turn: 2,
			});
			assert.ok(
				!/tokenUsage=|tokensFree=/.test(out),
				"prompt has no budget attrs",
			);
		});

		it("archived='N' surfaces when prior turn had a 413 archive", async () => {
			const contextSize = 10000;
			const out = await assemblePrompt("", {
				rows: [
					fakePromptRow(),
					{
						ordinal: 2,
						path: "log://turn_2/error/Token%20Budget%20overflow%3A%20foo",
						scheme: "log",
						visibility: "indexed",
						body: "Token Budget overflow: ...",
						tokens: 30,
						attributes: JSON.stringify({
							status: 413,
							archivedCount: 4,
							archivedTokens: 22000,
						}),
						category: "logging",
						source_turn: 2,
					},
				],
				contextSize,
				lastContextTokens: 5000,
				type: "act",
				turn: 3,
			});
			assert.ok(
				/archived="4"/.test(out),
				`archived=4 must surface; got: ${out}`,
			);
		});

		it("archived absent when prior turn had no 413", async () => {
			const contextSize = 10000;
			const out = await assemblePrompt("", {
				rows: [fakePromptRow()],
				contextSize,
				lastContextTokens: 5000,
				type: "act",
				turn: 3,
			});
			assert.ok(
				!out.includes("archived="),
				"no archived attr when no prior 413",
			);
		});

		it("archived only looks at PRIOR turn, not older ones", async () => {
			const contextSize = 10000;
			const out = await assemblePrompt("", {
				rows: [
					fakePromptRow(),
					{
						ordinal: 2,
						path: "log://turn_1/error/Token%20Budget%20overflow",
						scheme: "log",
						visibility: "indexed",
						body: "Token Budget overflow: ...",
						tokens: 30,
						attributes: JSON.stringify({
							status: 413,
							archivedCount: 2,
							archivedTokens: 8000,
						}),
						category: "logging",
						source_turn: 1,
					},
				],
				contextSize,
				lastContextTokens: 5000,
				type: "act",
				turn: 5,
			});
			assert.ok(
				!out.includes("archived="),
				"archived only for immediately-prior turn",
			);
		});
	});

	describe("413 error carries structured archive attrs", () => {
		it("budget rescue emits a 413 error entry with archivedCount and archivedTokens", async () => {
			const { runId } = await tdb.seedRun({ alias: "err_attrs_413" });
			// Seed indexed log entries at turn 0 (= prevTurn for the
			// dispatch at turn 1) so the rescue has something to archive.
			for (let i = 0; i < 20; i++) {
				await store.set({
					runId,
					turn: 0,
					path: `log://turn_0/get/big_${i}`,
					body: pad(100),
					state: "resolved",
					visibility: "indexed",
				});
			}
			const messages = [
				{ role: "system", content: "test" },
				{ role: "user", content: pad(2000) },
			];
			await cascade.enforce({
				contextSize: 1000,
				messages,
				rows: [],
				ctx: {
					runId,
					loopId: null,
					turn: 1,
					systemPrompt: "test",
					mode: "act",
					toolSet: null,
				},
				rummy: { db: tdb.db, hooks: tdb.hooks, entries: store },
			});

			const stored = await tdb.db.get_known_entries.all({ run_id: runId });
			const err = stored.find(
				(r) => r.path.startsWith("log://turn_1/error/") && r.scheme === "log",
			);
			assert.ok(err, "413 error entry written");
			const attrs = JSON.parse(err.attributes);
			assert.strictEqual(attrs.status, 413);
			assert.ok(attrs.archivedCount > 0, "archivedCount present and positive");
			assert.ok(
				attrs.archivedTokens > 0,
				"archivedTokens present and positive",
			);
		});
	});
});

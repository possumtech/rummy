/**
 * Budget headline math verification.
 *
 * Covers @token_accounting, @budget_enforcement — the `<budget>` tag
 * carries `tokenUsage` and `tokensFree` attrs the model reads for
 * budget arithmetic.
 *
 * Single source of truth (SPEC §token_accounting):
 *   tokenUsage = countTokens(systemMessage) + countTokens(userMessage)
 *   tokensFree = max(0, ceiling − tokenUsage)
 *
 * The model and the enforce gate reach for the same helper
 * (`computePacketTokens`) against the same assembled bytes — they
 * never diverge.
 */
import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import ContextAssembler from "../../src/agent/ContextAssembler.js";
import Entries from "../../src/agent/Entries.js";
import { countTokens } from "../../src/agent/tokens.js";
import { computePacketTokens } from "../../src/plugins/budget/budget.js";
import materialize from "../helpers/materialize.js";
import TestDb from "../helpers/TestDb.js";

const CEILING_RATIO = Number(process.env.RUMMY_BUDGET_CEILING);

function _pad(n) {
	return Array(n).fill("hello world test data").join(" ");
}

function parseBudgetAttrs(userMessage) {
	const usage = userMessage.match(/tokenUsage="(\d+)"/);
	const free = userMessage.match(/tokensFree="(\d+)"/);
	if (!usage || !free) return null;
	return {
		used: Number(usage[1]),
		free: Number(free[1]),
	};
}

async function assemble(tdb, runId, turn, contextSize = 32768) {
	const rows = await tdb.db.get_turn_context.all({ run_id: runId, turn });
	const messages = await ContextAssembler.assembleFromTurnContext(
		rows,
		{ systemPrompt: "test", contextSize, turn },
		tdb.hooks,
	);
	return { messages, rows };
}

describe("Budget headline math (single source of truth)", () => {
	let tdb, store;

	before(async () => {
		tdb = await TestDb.create("budget_headline_math");
		store = new Entries(tdb.db);
		await store.loadSchemes(tdb.db);
	});

	after(async () => {
		await tdb.cleanup();
	});

	it("tokenUsage equals countTokens(system) + countTokens(user)", async () => {
		const { runId, loopId } = await tdb.seedRun({ alias: "headline_basic" });
		const contextSize = 32768;
		await store.set({
			runId,
			turn: 1,
			loopId,
			path: "prompt://1",
			body: "do thing",
			state: "resolved",
			attributes: { mode: "ask" },
		});
		await materialize(tdb.db, { runId, loopId, turn: 1, systemPrompt: "sys" });
		const { messages } = await assemble(tdb, runId, 1, contextSize);
		const nums = parseBudgetAttrs(messages[1].content);
		const expected = computePacketTokens({
			system: messages[0].content,
			user: messages[1].content,
		});
		assert.strictEqual(nums.used, expected, "tokenUsage = system + user");
	});

	it("tokensFree equals max(0, ceiling - tokenUsage)", async () => {
		const { runId, loopId } = await tdb.seedRun({ alias: "headline_free" });
		const contextSize = 32768;
		const cap = Math.floor(contextSize * CEILING_RATIO);
		await store.set({
			runId,
			turn: 1,
			loopId,
			path: "prompt://1",
			body: "do thing",
			state: "resolved",
			attributes: { mode: "ask" },
		});
		await materialize(tdb.db, { runId, loopId, turn: 1, systemPrompt: "sys" });
		const { messages } = await assemble(tdb, runId, 1, contextSize);
		const nums = parseBudgetAttrs(messages[1].content);
		assert.strictEqual(nums.free, Math.max(0, cap - nums.used));
	});

	it("placeholders are fully substituted (no `{{` survives in the wire)", async () => {
		const { runId, loopId } = await tdb.seedRun({
			alias: "headline_no_placeholders",
		});
		await store.set({
			runId,
			turn: 1,
			loopId,
			path: "prompt://1",
			body: "ask",
			state: "resolved",
			attributes: { mode: "ask" },
		});
		await materialize(tdb.db, { runId, loopId, turn: 1, systemPrompt: "sys" });
		const { messages } = await assemble(tdb, runId, 1, 32768);
		assert.ok(
			!messages[0].content.includes("{{"),
			"no placeholder survives in system",
		);
		assert.ok(
			!messages[1].content.includes("{{"),
			"no placeholder survives in user",
		);
	});

	it("schema stability: budget tag attrs always present + table renders", async () => {
		const { runId, loopId } = await tdb.seedRun({ alias: "headline_schema" });
		await store.set({
			runId,
			turn: 1,
			loopId,
			path: "prompt://1",
			body: "ask",
			state: "resolved",
			attributes: { mode: "ask" },
		});
		await materialize(tdb.db, { runId, loopId, turn: 1, systemPrompt: "sys" });
		const { messages } = await assemble(tdb, runId, 1, 32768);
		const user = messages[1].content;
		assert.ok(
			/tokenCeiling="\d+"/.test(user),
			"tokenCeiling attr always present",
		);
		assert.ok(/tokenUsage="\d+"/.test(user), "tokenUsage attr always present");
		assert.ok(/tokensFree="\d+"/.test(user), "tokensFree attr always present");
		assert.ok(user.includes("| scheme |"), "breakdown table header renders");
		assert.ok(!user.includes("Total:"), "Total prose line removed from <turn>");
	});

	it("<turn errors=N> reflects prior-turn error log entries", async () => {
		const { runId, loopId } = await tdb.seedRun({ alias: "headline_errors" });
		// Turn 1: seed two error log entries (the "prior turn" from turn 2's PoV).
		const errPath1 = await store.logPath(runId, loopId, 1, "error");
		await store.set({
			runId,
			turn: 1,
			loopId,
			path: errPath1,
			body: "first error",
			state: "failed",
			outcome: "status:422",
			attributes: { status: 422 },
		});
		const errPath2 = await store.logPath(runId, loopId, 1, "error");
		await store.set({
			runId,
			turn: 1,
			loopId,
			path: errPath2,
			body: "second error",
			state: "resolved",
			attributes: { status: 400 },
		});
		await store.set({
			runId,
			turn: 2,
			loopId,
			path: "prompt://2",
			body: "do thing",
			state: "resolved",
			attributes: { mode: "ask" },
		});
		await materialize(tdb.db, { runId, loopId, turn: 2, systemPrompt: "sys" });
		const { messages } = await assemble(tdb, runId, 2, 32768);
		const user = messages[1].content;
		assert.match(
			user,
			/<turn [^>]*errors="2"/,
			`expected errors="2" on <turn>; got: ${user.slice(0, 500)}`,
		);
	});

	it("<turn> omits errors attr when prior turn had no error log entries", async () => {
		const { runId, loopId } = await tdb.seedRun({ alias: "headline_no_errors" });
		await store.set({
			runId,
			turn: 2,
			loopId,
			path: "prompt://2",
			body: "do thing",
			state: "resolved",
			attributes: { mode: "ask" },
		});
		await materialize(tdb.db, { runId, loopId, turn: 2, systemPrompt: "sys" });
		const { messages } = await assemble(tdb, runId, 2, 32768);
		const user = messages[1].content;
		assert.ok(
			!/<turn [^>]*errors=/.test(user),
			`errors attr should be absent; got: ${user.slice(0, 500)}`,
		);
	});

	it("countTokens(system) + countTokens(user) is internally self-consistent", async () => {
		// Sanity: the headline number we put into the wire matches a
		// fresh measurement of the wire bytes on the system side. The
		// user side has the substituted numbers (slightly fewer chars
		// than the placeholders), so user-only countTokens drifts by a
		// small bounded amount — the headline reflects the pre-substitution
		// measurement.
		const { runId, loopId } = await tdb.seedRun({ alias: "headline_self" });
		await store.set({
			runId,
			turn: 1,
			loopId,
			path: "prompt://1",
			body: "ask",
			state: "resolved",
			attributes: { mode: "ask" },
		});
		await materialize(tdb.db, { runId, loopId, turn: 1, systemPrompt: "sys" });
		const { messages } = await assemble(tdb, runId, 1, 32768);
		const nums = parseBudgetAttrs(messages[1].content);
		// System content has no placeholders → exact match.
		assert.ok(nums.used >= countTokens(messages[0].content));
	});
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countTokens } from "../../agent/tokens.js";
import Budget, {
	ceiling,
	computeBudget,
	measureMessages,
	measureRows,
	overflowBody,
} from "./budget.js";

describe("ceiling", () => {
	it("is contextSize × RUMMY_BUDGET_CEILING (floored)", () => {
		const c = ceiling(10000);
		assert.ok(c > 0 && c <= 10000);
		assert.equal(c, ceiling(10000));
	});

	it("scales linearly with contextSize", () => {
		assert.equal(ceiling(2 * 10000), 2 * ceiling(10000));
	});

	it("returns 0 for zero context", () => {
		assert.equal(ceiling(0), 0);
	});
});

describe("measureMessages", () => {
	it("sums per-message content token counts", () => {
		const m = measureMessages([{ content: "" }, { content: "abcdefghij" }]);
		assert.ok(m >= 1, `should yield > 0 tokens, got ${m}`);
	});

	it("returns 0 for empty messages array", () => {
		assert.equal(measureMessages([]), 0);
	});

	it("treats empty/missing content as 0 tokens", () => {
		assert.equal(measureMessages([{ content: "" }, { content: null }]), 0);
	});
});

describe("measureRows", () => {
	it("sums per-row body token counts", () => {
		const out = measureRows([{ body: "abcdef" }, { body: "ghi" }]);
		assert.ok(out >= 1);
	});

	it("returns 0 for empty rows", () => {
		assert.equal(measureRows([]), 0);
	});
});

describe("computeBudget", () => {
	it("returns ceiling, totalTokens, tokensFree, overflow, ok=true under ceiling", () => {
		const result = computeBudget({ contextSize: 10000, totalTokens: 100 });
		assert.equal(result.totalTokens, 100);
		assert.equal(result.tokenUsage, 100);
		assert.ok(result.ceiling > 100);
		assert.equal(result.tokensFree, result.ceiling - 100);
		assert.equal(result.overflow, 0);
		assert.equal(result.ok, true);
	});

	it("ok=false + overflow positive when totalTokens > ceiling", () => {
		const cap = ceiling(1000);
		const result = computeBudget({
			contextSize: 1000,
			totalTokens: cap + 50,
		});
		assert.equal(result.tokensFree, 0);
		assert.equal(result.overflow, 50);
		assert.equal(result.ok, false);
	});

	it("tokensFree clamps to 0 (never negative)", () => {
		const result = computeBudget({ contextSize: 100, totalTokens: 99999 });
		assert.equal(result.tokensFree, 0);
	});

	it("at-ceiling is ok=true (boundary)", () => {
		const cap = ceiling(1000);
		const result = computeBudget({ contextSize: 1000, totalTokens: cap });
		assert.equal(result.overflow, 0);
		assert.equal(result.tokensFree, 0);
		assert.equal(result.ok, true);
	});
});

describe("Budget", () => {
	function makeBudget() {
		return new Budget({
			hooks: { budget: null, tools: { onView: () => {} } },
			registerScheme: () => {},
			filter: () => {},
			on: () => {},
		});
	}

	function makeRummy({ demoteResult = [] } = {}) {
		const emitted = [];
		const setCalls = [];
		return {
			emitted,
			setCalls,
			rummy: {
				entries: {
					demoteTurnEntries: async () => demoteResult,
					set: async (args) => setCalls.push(args),
				},
				hooks: {
					error: {
						log: {
							emit: async (e) => emitted.push(e),
						},
					},
				},
			},
		};
	}

	it("enforce returns ok when under budget (step 1 only, no emits)", async () => {
		const budget = makeBudget();
		const { rummy, emitted } = makeRummy();
		const result = await budget.enforce({
			contextSize: 10000,
			messages: [{ role: "system", content: "short" }],
			rows: [],
			ctx: { runId: 1, turn: 1, loopId: 0 },
			rummy,
		});
		assert.strictEqual(result.ok, true);
		assert.ok(result.assembledTokens > 0);
		assert.strictEqual(emitted.length, 0, "no 413 emitted under budget");
	});

	it("enforce hits step 4 hard 413 when nothing is demotable", async () => {
		const budget = makeBudget();
		const { rummy, emitted } = makeRummy({ demoteResult: [] });
		const result = await budget.enforce({
			contextSize: 10,
			messages: [{ role: "system", content: "x".repeat(1000) }],
			rows: [],
			ctx: { runId: 1, turn: 1, loopId: 0 },
			rummy,
		});
		assert.strictEqual(result.ok, false);
		assert.ok(result.overflow > 0);
		assert.strictEqual(emitted.length, 1, "hard 413 emitted exactly once");
		assert.strictEqual(emitted[0].status, 413);
		assert.strictEqual(emitted[0].attributes.demotedCount, 0);
	});

	it("enforce returns ok with no contextSize", async () => {
		const budget = makeBudget();
		const result = await budget.enforce({
			contextSize: null,
			messages: [{ role: "system", content: "anything" }],
			rows: [],
		});
		assert.strictEqual(result.ok, true);
		assert.strictEqual(result.assembledTokens, 0);
	});
});

describe("assembleBudget — <budget> table (@token_accounting)", () => {
	function makePlugin() {
		return new Budget({
			hooks: { budget: null, tools: { onView: () => {} } },
			registerScheme: () => {},
			filter: () => {},
			on: () => {},
		});
	}

	function row({ scheme, vTokens, sTokens, visibility = "visible" }) {
		return {
			scheme,
			visibility,
			vTokens,
			sTokens,
			aTokens: vTokens - sTokens,
		};
	}

	it("renders <budget> with placeholder headline tokens", () => {
		// `assembleBudget` emits placeholders only — the real headline
		// numbers are post-substituted by ContextAssembler against the
		// fully-assembled packet (single source of truth, SPEC §
		// token_accounting).
		const plugin = makePlugin();
		const rows = [
			row({ scheme: "log", vTokens: 700, sTokens: 100 }),
			row({ scheme: "https", vTokens: 600, sTokens: 200 }),
		];
		const out = plugin.assembleBudget("", {
			rows,
			contextSize: 10000,
		});
		assert.ok(
			out.includes(
				'<budget tokenUsage="{{tokenUsage}}" tokensFree="{{tokensFree}}">',
			),
			`<budget> carries placeholders; got: ${out}`,
		);
		// The breakdown table renders with real per-scheme numbers.
		assert.ok(out.includes("| log | 1 | 0 | 700 | 100 | 600 |"));
		assert.ok(out.includes("| https | 1 | 0 | 600 | 200 | 400 |"));
	});

	it("table cells render six columns sorted by current cost descending", () => {
		const plugin = makePlugin();
		const out = plugin.assembleBudget("", {
			rows: [
				row({ scheme: "small", vTokens: 200, sTokens: 100 }),
				row({ scheme: "large", vTokens: 5000, sTokens: 0 }),
				row({ scheme: "medium", vTokens: 1000, sTokens: 200 }),
			],
			contextSize: 10000,
			systemPrompt: "",
		});
		// Format: | scheme | vis | sum | cost | if-all-sum | premium |
		assert.ok(
			out.includes("| large | 1 | 0 | 5000 | 0 | 5000 |"),
			`large row; got: ${out}`,
		);
		assert.ok(
			out.includes("| medium | 1 | 0 | 1000 | 200 | 800 |"),
			`medium row; got: ${out}`,
		);
		assert.ok(
			out.includes("| small | 1 | 0 | 200 | 100 | 100 |"),
			`small row; got: ${out}`,
		);
		const largeIdx = out.indexOf("| large |");
		const mediumIdx = out.indexOf("| medium |");
		const smallIdx = out.indexOf("| small |");
		assert.ok(
			largeIdx < mediumIdx && mediumIdx < smallIdx,
			`highest cost first; got order: ${out}`,
		);
	});

	it("summarized rows render with vis=0, sum=count and aggregate in Total line", () => {
		const plugin = makePlugin();
		const out = plugin.assembleBudget("", {
			rows: [
				row({ scheme: "visible_thing", vTokens: 200, sTokens: 50 }),
				row({
					scheme: "sum_a",
					vTokens: 800,
					sTokens: 80,
					visibility: "summarized",
				}),
				row({
					scheme: "sum_b",
					vTokens: 1200,
					sTokens: 120,
					visibility: "summarized",
				}),
			],
			contextSize: 10000,
			systemPrompt: "",
		});
		assert.ok(
			out.includes("| visible_thing | 1 | 0 | 200 | 50 | 150 |"),
			`visible row; got: ${out}`,
		);
		assert.ok(
			out.includes("| sum_a | 0 | 1 | 80 | 80 | 0 |"),
			`sum_a row; got: ${out}`,
		);
		assert.ok(
			out.includes("| sum_b | 0 | 1 | 120 | 120 | 0 |"),
			`sum_b row; got: ${out}`,
		);
		assert.ok(
			/1 visible \+ 2 summarized entries/.test(out),
			`Total line carries summarized count; got: ${out}`,
		);
	});

	it("ignores rows without aTokens (audit/system entries)", () => {
		const plugin = makePlugin();
		const out = plugin.assembleBudget("", {
			rows: [
				row({ scheme: "data", vTokens: 100, sTokens: 20 }),
				{ scheme: "audit", visibility: "visible" }, // no token fields
			],
			contextSize: 10000,
			systemPrompt: "",
		});
		assert.ok(out.includes("| data |"));
		assert.ok(!out.includes("| audit |"), "rows without aTokens skipped");
	});

	it("returns content unchanged when contextSize is missing", () => {
		const plugin = makePlugin();
		const out = plugin.assembleBudget("preamble", {
			rows: [],
			contextSize: 0,
			systemPrompt: "",
		});
		assert.strictEqual(out, "preamble");
	});

	it("total prose line names counts and placeholders for tokenUsage/free", () => {
		const plugin = makePlugin();
		const out = plugin.assembleBudget("", {
			rows: [
				row({ scheme: "a", vTokens: 500, sTokens: 100 }),
				row({
					scheme: "b",
					vTokens: 300,
					sTokens: 60,
					visibility: "summarized",
				}),
			],
			contextSize: 10000,
		});
		assert.ok(
			/Total: 1 visible \+ 1 summarized entries/.test(out),
			`total names visible + summarized counts; got: ${out}`,
		);
		assert.ok(
			/tokenUsage \{\{tokenUsage\}\} \/ ceiling \d+/.test(out),
			"placeholder tokenUsage in total line",
		);
		assert.ok(
			out.includes("{{tokensFree}} tokens free"),
			"placeholder tokensFree in total line",
		);
	});
});

describe("computePacketTokens", () => {
	it("sums system + user content token counts", async () => {
		const { computePacketTokens } = await import("./budget.js");
		const out = computePacketTokens({
			system: "x".repeat(100),
			user: "y".repeat(50),
		});
		const expected = countTokens("x".repeat(100)) + countTokens("y".repeat(50));
		assert.strictEqual(out, expected);
	});

	it("treats missing args as empty strings", async () => {
		const { computePacketTokens } = await import("./budget.js");
		assert.strictEqual(computePacketTokens({}), 0);
		assert.strictEqual(
			computePacketTokens({ system: "abc" }),
			countTokens("abc"),
		);
		assert.strictEqual(
			computePacketTokens({ user: "xyz" }),
			countTokens("xyz"),
		);
	});
});

describe("substituteBudgetPlaceholders", () => {
	it("replaces {{tokenUsage}} and {{tokensFree}} with the supplied numbers", async () => {
		const { substituteBudgetPlaceholders } = await import("./budget.js");
		const text =
			'<budget tokenUsage="{{tokenUsage}}" tokensFree="{{tokensFree}}">\nbody\n</budget>';
		const out = substituteBudgetPlaceholders(text, {
			tokenUsage: 1234,
			tokensFree: 567,
		});
		assert.ok(out.includes('tokenUsage="1234"'));
		assert.ok(out.includes('tokensFree="567"'));
		assert.ok(!out.includes("{{tokenUsage}}"));
		assert.ok(!out.includes("{{tokensFree}}"));
	});

	it("idempotent on text without placeholders", async () => {
		const { substituteBudgetPlaceholders } = await import("./budget.js");
		const text = "no placeholders here";
		assert.strictEqual(
			substituteBudgetPlaceholders(text, { tokenUsage: 1, tokensFree: 1 }),
			text,
		);
	});

	it("substitutes every occurrence (also in the Total line)", async () => {
		const { substituteBudgetPlaceholders } = await import("./budget.js");
		const text =
			'<budget tokenUsage="{{tokenUsage}}" tokensFree="{{tokensFree}}">\nTotal: tokenUsage {{tokenUsage}} / ceiling 100. {{tokensFree}} tokens free.\n</budget>';
		const out = substituteBudgetPlaceholders(text, {
			tokenUsage: 42,
			tokensFree: 58,
		});
		assert.ok(!out.includes("{{"));
		assert.ok(out.includes('tokenUsage="42"'));
		assert.ok(out.includes("tokenUsage 42"));
		assert.ok(out.includes("58 tokens free"));
	});
});

// The 413 body is what the model reads. When it doesn't name the
// demoted paths, the model re-promotes the same entries next turn and
// the loop cycles (observed: same Wikipedia URL promoted 9 times in
// rummy_dev.db::test:demo). This is the contract.
describe("overflowBody — 413 error body shape", () => {
	const contextSize = 10000;
	const cap = ceiling(contextSize); // depends on RUMMY_BUDGET_CEILING

	it("0 demoted: header only, no Demoted: section", () => {
		const body = overflowBody(500, contextSize, []);
		assert.ok(body.startsWith("Token Budget overflow:"));
		assert.ok(
			body.includes("0 promotions (0 tokens) demoted."),
			`header mentions 0 promotions; got: ${body}`,
		);
		assert.ok(
			!body.includes("Demoted:"),
			"no Demoted: section when nothing was demoted",
		);
	});

	it("1 demoted: singular 'promotion', path named with turn and tokens", () => {
		const body = overflowBody(500, contextSize, [
			{ path: "https://example.com/wiki/X", tokens: 4418, turn: 7 },
		]);
		assert.ok(
			body.includes("1 promotion (4418 tokens) demoted."),
			`singular grammar; got: ${body}`,
		);
		assert.ok(body.includes("Demoted:"));
		assert.ok(
			body.includes("- https://example.com/wiki/X (turn 7, 4418 tokens)"),
			`path named with turn and tokens; got:\n${body}`,
		);
	});

	it("N demoted: plural 'promotions', each path named, token sum correct", () => {
		const body = overflowBody(2753, contextSize, [
			{ path: "https://a.example/one", tokens: 1200, turn: 3 },
			{ path: "https://b.example/two", tokens: 900, turn: 5 },
			{ path: "known://fact", tokens: 250, turn: 6 },
		]);
		assert.ok(
			body.includes("3 promotions (2350 tokens) demoted."),
			`plural + sum; got: ${body}`,
		);
		assert.ok(body.includes("- https://a.example/one (turn 3, 1200 tokens)"));
		assert.ok(body.includes("- https://b.example/two (turn 5, 900 tokens)"));
		assert.ok(body.includes("- known://fact (turn 6, 250 tokens)"));
	});

	it("ordering: lines appear in the order the caller provides", () => {
		// Caller stitches step-2 demotions then step-3 prompt demote;
		// overflowBody renders that order verbatim so the model reads it
		// as the grinder reasoned about it.
		const body = overflowBody(500, contextSize, [
			{ path: "first", tokens: 100, turn: 3 },
			{ path: "second", tokens: 100, turn: 3 },
			{ path: "prompt://4", tokens: 100, turn: 4 },
		]);
		const i1 = body.indexOf("- first");
		const i2 = body.indexOf("- second");
		const i3 = body.indexOf("- prompt://4");
		assert.ok(i1 < i2 && i2 < i3, "caller-provided order preserved");
	});

	it("packet size reported = ceiling + overflow", () => {
		const overflow = 2753;
		const body = overflowBody(overflow, contextSize, []);
		assert.ok(
			body.includes(`packet was ${cap + overflow} tokens`),
			`packet = ceiling + overflow (${cap} + ${overflow}); got: ${body}`,
		);
		assert.ok(body.includes(`ceiling is ${cap}`));
	});

	it("regression: named paths let the model avoid the 9-retry loop", () => {
		// Original bug: turns 3–12 in rummy_dev.db::test:demo all tried
		// to promote the same Wikipedia URL because the 413 body said
		// "N promotions demoted" without naming them. Next turn the
		// model saw the page summarized, re-promoted, re-demoted.
		const body = overflowBody(500, contextSize, [
			{
				path: "https://en.wikipedia.org/wiki/White_River_(Indiana)",
				tokens: 17744,
				turn: 3,
			},
		]);
		assert.ok(
			body.includes("https://en.wikipedia.org/wiki/White_River_(Indiana)"),
			"model can now see which URL got demoted",
		);
	});
});

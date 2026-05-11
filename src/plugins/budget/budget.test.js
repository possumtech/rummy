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
			hooks: { tools: { onView: () => {} } },
			registerScheme: () => {},
			filter: () => {},
			on: () => {},
		});
	}

	function makeRummy({ archiveResult = [] } = {}) {
		const emitted = [];
		const setCalls = [];
		return {
			emitted,
			setCalls,
			rummy: {
				entries: {
					archiveTurnEntries: async () => archiveResult,
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

	it("enforce hits hard 413 when nothing in t-1 to archive", async () => {
		const budget = makeBudget();
		const { rummy, emitted } = makeRummy({ archiveResult: [] });
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
		assert.strictEqual(emitted[0].attributes.archivedCount, 0);
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

describe("assembleTurn — <turn> table (@token_accounting)", () => {
	function makePlugin() {
		return new Budget({
			hooks: {
				tools: {
					onView: () => {},
					names: ["get", "set"],
					advertisedNames: ["get", "set"],
				},
			},
			registerScheme: () => {},
			filter: () => {},
			on: () => {},
		});
	}

	function row({ scheme, vTokens, visibility = "indexed" }) {
		return {
			scheme,
			visibility,
			vTokens,
			aTokens: vTokens,
		};
	}

	it("renders <turn> with placeholder headline tokens", () => {
		// `assembleBudget` emits placeholders only — the real headline
		// numbers are post-substituted by ContextAssembler against the
		// fully-assembled packet (single source of truth, SPEC §
		// token_accounting).
		const plugin = makePlugin();
		const rows = [
			row({ scheme: "log", vTokens: 700 }),
			row({ scheme: "https", vTokens: 600 }),
		];
		const out = plugin.assembleTurn("", {
			rows,
			contextSize: 10000,
		});
		assert.match(out, /<turn /, `opens with <turn ; got: ${out}`);
		assert.match(out, /tokenUsage="\{\{tokenUsage\}\}"/);
		assert.match(out, /tokensFree="\{\{tokensFree\}\}"/);
		assert.match(out, /commands="get,set"/, "commands attr present");
		// Three columns now: indexed | archived | tokens.
		assert.ok(out.includes("| log | 1 | 0 | 700 |"));
		assert.ok(out.includes("| https | 1 | 0 | 600 |"));
	});

	it("table cells sorted by indexed-token cost descending", () => {
		const plugin = makePlugin();
		const out = plugin.assembleTurn("", {
			rows: [
				row({ scheme: "small", vTokens: 200 }),
				row({ scheme: "large", vTokens: 5000 }),
				row({ scheme: "medium", vTokens: 1000 }),
			],
			contextSize: 10000,
			systemPrompt: "",
		});
		assert.ok(out.includes("| large | 1 | 0 | 5000 |"));
		assert.ok(out.includes("| medium | 1 | 0 | 1000 |"));
		assert.ok(out.includes("| small | 1 | 0 | 200 |"));
		const largeIdx = out.indexOf("| large |");
		const mediumIdx = out.indexOf("| medium |");
		const smallIdx = out.indexOf("| small |");
		assert.ok(
			largeIdx < mediumIdx && mediumIdx < smallIdx,
			`highest cost first; got order: ${out}`,
		);
	});

	it("archived rows render with indexed=0, archived=count in the table", () => {
		const plugin = makePlugin();
		const out = plugin.assembleTurn("", {
			rows: [
				row({ scheme: "indexed_thing", vTokens: 200 }),
				row({ scheme: "arc_a", vTokens: 0, visibility: "archived" }),
				row({ scheme: "arc_b", vTokens: 0, visibility: "archived" }),
			],
			contextSize: 10000,
			systemPrompt: "",
		});
		assert.ok(out.includes("| indexed_thing | 1 | 0 | 200 |"));
		assert.ok(out.includes("| arc_a | 0 | 1 | 0 |"));
		assert.ok(out.includes("| arc_b | 0 | 1 | 0 |"));
		assert.ok(!out.includes("Total:"), "Total line is removed");
	});

	it("ignores rows without aTokens (audit/system entries)", () => {
		const plugin = makePlugin();
		const out = plugin.assembleTurn("", {
			rows: [
				row({ scheme: "data", vTokens: 100 }),
				{ scheme: "audit", visibility: "indexed" }, // no token fields
			],
			contextSize: 10000,
			systemPrompt: "",
		});
		assert.ok(out.includes("| data |"));
		assert.ok(!out.includes("| audit |"), "rows without aTokens skipped");
	});

	it("returns content unchanged when contextSize is missing", () => {
		const plugin = makePlugin();
		const out = plugin.assembleTurn("preamble", {
			rows: [],
			contextSize: 0,
			systemPrompt: "",
		});
		assert.strictEqual(out, "preamble");
	});

	it("<turn> opening carries tokenCeiling, tokenUsage, tokensFree attrs", () => {
		const plugin = makePlugin();
		const out = plugin.assembleTurn("", {
			rows: [
				row({ scheme: "a", vTokens: 500 }),
				row({ scheme: "b", vTokens: 0, visibility: "archived" }),
			],
			contextSize: 10000,
		});
		assert.ok(
			/<turn [^>]*tokenCeiling="\d+"/.test(out),
			"<turn> has tokenCeiling attr",
		);
		assert.ok(
			/<turn [^>]*tokenUsage="\{\{tokenUsage\}\}"/.test(out),
			"<turn> carries tokenUsage placeholder",
		);
		assert.ok(
			/<turn [^>]*tokensFree="\{\{tokensFree\}\}"/.test(out),
			"<turn> carries tokensFree placeholder",
		);
		assert.ok(!out.includes("Total:"), "Total line is removed");
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
			'<turn tokenUsage="{{tokenUsage}}" tokensFree="{{tokensFree}}">\nbody\n</budget>';
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
			'<turn tokenUsage="{{tokenUsage}}" tokensFree="{{tokensFree}}">\nTotal: tokenUsage {{tokenUsage}} / ceiling 100. {{tokensFree}} tokens free.\n</budget>';
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

// The 413 body is what the model reads. Names what was archived from
// Names what fat replays were reclaimed so the model can re-fetch.
describe("overflowBody — 413 error body shape", () => {
	const contextSize = 10000;
	const cap = ceiling(contextSize);

	it("0 reclaimed: header only, no listing", () => {
		const body = overflowBody(500, contextSize, []);
		assert.ok(body.startsWith("Token Budget overflow:"));
		assert.match(body, /0 fat replays \(0 tokens\) reclaimed\./);
		assert.equal(body.includes("\n*"), false);
	});

	it("1 reclaimed: singular grammar; manifest line", () => {
		const body = overflowBody(500, contextSize, [
			{ path: "log://turn_7/get/x", tokens: 4418, turn: 7 },
		]);
		assert.match(body, /1 fat replay \(4418 tokens\) reclaimed\./);
		assert.match(body, /\* log:\/\/turn_7\/get\/x - 4418 tokens/);
	});

	it("N reclaimed: plural; each path in manifest format (S8)", () => {
		const body = overflowBody(2753, contextSize, [
			{ path: "log://turn_3/get/b", tokens: 900, turn: 3 },
			{ path: "log://turn_3/set/c", tokens: 250, turn: 3 },
		]);
		assert.match(body, /2 fat replays \(1150 tokens\) reclaimed\./);
		assert.match(body, /\* log:\/\/turn_3\/get\/b - 900 tokens/);
		assert.match(body, /\* log:\/\/turn_3\/set\/c - 250 tokens/);
	});

	it("packet size reported = ceiling + overflow", () => {
		const overflow = 2753;
		const body = overflowBody(overflow, contextSize, []);
		assert.match(body, new RegExp(`packet was ${cap + overflow} tokens`));
		assert.match(body, new RegExp(`ceiling is ${cap}`));
	});
});

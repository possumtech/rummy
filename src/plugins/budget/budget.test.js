import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countTokens } from "../../agent/tokens.js";
import Budget, {
	ceiling,
	computeBudget,
	measureMessages,
	measureRows,
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

describe("Budget.enforce — two-layer overflow policy", () => {
	function makeBudget() {
		return new Budget({
			hooks: { tools: { onView: () => {} } },
			registerScheme: () => {},
			filter: () => {},
			on: () => {},
		});
	}

	// Stubbed harness: messages are paired with rows whose bodies the
	// stub assembler concatenates back into a single user message after
	// re-projection. Layer 1 / Layer 2 archives mark rows as archived;
	// the stub assembler skips archived rows, mimicking real assembly.
	function makeRummy({ initialUser = "", systemContent = "" } = {}) {
		const emitted = [];
		const setCalls = [];
		const rows = [];
		const rummy = {
			entries: {
				set: async (args) => {
					setCalls.push(args);
					if (args.visibility) {
						const row = rows.find((r) => r.path === args.path);
						if (row) row.visibility = args.visibility;
					}
				},
			},
			hooks: {
				error: { log: { emit: async (e) => emitted.push(e) } },
				assembly: {
					system: {
						filter: async (val, _ctx) => {
							// Stub: pass through system content untouched.
							return val || systemContent;
						},
					},
					user: {
						filter: async (val, ctx) => {
							// Stub: project user content from visible rows.
							const visible = ctx.rows
								.filter(
									(r) => r.category === "data" && r.visibility === "indexed",
								)
								.map((r) => r.body ?? "")
								.join("\n");
							const logVisible = ctx.rows
								.filter((r) => r.scheme === "log" && r.visibility === "indexed")
								.map((r) => r.body ?? "")
								.join("\n");
							return [val || initialUser, visible, logVisible]
								.filter(Boolean)
								.join("\n");
						},
					},
				},
			},
		};
		return { rummy, emitted, setCalls, rows };
	}

	function logRow({
		loop = 1,
		turn,
		seq,
		action,
		body,
		visibility = "indexed",
	}) {
		return {
			path: `log://${loop}/${turn}/${seq}/${action}`,
			scheme: "log",
			category: "logging",
			visibility,
			body,
			aTokens: countTokens(body),
		};
	}

	function dataRow({ path, scheme = "known", body, visibility = "indexed" }) {
		return {
			path,
			scheme,
			category: "data",
			visibility,
			body,
			aTokens: countTokens(body),
		};
	}

	it("returns ok when packet fits — no emits, no archives", async () => {
		const budget = makeBudget();
		const { rummy, emitted, setCalls } = makeRummy();
		const result = await budget.enforce({
			contextSize: 10000,
			messages: [
				{ role: "system", content: "short" },
				{ role: "user", content: "short" },
			],
			rows: [],
			ctx: { runId: 1, turn: 2, loopId: 1 },
			rummy,
		});
		assert.equal(result.ok, true);
		assert.equal(emitted.length, 0);
		assert.equal(setCalls.length, 0);
	});

	it("layer 1: prior-turn log archive resolves overflow — hard 413, glob in body", async () => {
		const budget = makeBudget();
		const fat = "x".repeat(2000);
		const { rummy, emitted, setCalls, rows } = makeRummy();
		rows.push(
			logRow({ turn: 1, seq: 1, action: "get", body: fat }),
			logRow({ turn: 2, seq: 1, action: "prompt", body: "prompt" }),
		);
		const result = await budget.enforce({
			contextSize: 1000,
			messages: [
				{ role: "system", content: "sys" },
				{ role: "user", content: fat },
			],
			rows,
			ctx: { runId: 1, turn: 2, loopId: 1, mode: "ask" },
			rummy,
		});
		assert.equal(result.ok, true);
		assert.equal(setCalls.length, 1, "one archive call (the prior-turn log)");
		assert.equal(setCalls[0].visibility, "archived");
		assert.equal(setCalls[0].path, "log://1/1/1/get");
		assert.equal(emitted.length, 1);
		assert.equal(emitted[0].status, 413);
		assert.equal(emitted[0].soft, false, "turn > 1 strikes");
		assert.match(emitted[0].message, /log:\/\/1\/1\/\*\* archived\./);
	});

	it("layer 2: index archive (repo://manifest preserved) when layer 1 isn't enough", async () => {
		const budget = makeBudget();
		const fatLog = "x".repeat(500);
		const fatKnown = "k".repeat(2000);
		const { rummy, emitted, setCalls, rows } = makeRummy();
		rows.push(
			logRow({ turn: 1, seq: 1, action: "get", body: fatLog }),
			dataRow({ path: "known://big", body: fatKnown }),
			dataRow({ path: "repo://manifest", scheme: "repo", body: "manifest" }),
		);
		const result = await budget.enforce({
			contextSize: 1000,
			messages: [
				{ role: "system", content: "sys" },
				{ role: "user", content: fatLog + fatKnown },
			],
			rows,
			ctx: { runId: 1, turn: 2, loopId: 1, mode: "ask" },
			rummy,
		});
		// Layer 1 archived the log; layer 2 archived known://big but not manifest.
		const archived = setCalls.filter((c) => c.visibility === "archived");
		const archivedPaths = archived.map((c) => c.path);
		assert.ok(archivedPaths.includes("log://1/1/1/get"), "layer 1 fired");
		assert.ok(archivedPaths.includes("known://big"), "layer 2 archived known");
		assert.ok(!archivedPaths.includes("repo://manifest"), "manifest preserved");
		const last = emitted[emitted.length - 1];
		assert.equal(last.status, 413);
		assert.match(
			last.message,
			/log:\/\/1\/1\/\*\* archived; index archived \(repo:\/\/manifest preserved\)\./,
		);
		assert.equal(last.soft, false, "turn > 1 strikes");
		assert.equal(result.ok, true);
	});

	it("turn 1 overflow: layer 1 no-op, layer 2 fires soft (no strike)", async () => {
		const budget = makeBudget();
		const fatKnown = "k".repeat(3000);
		const { rummy, emitted, setCalls, rows } = makeRummy();
		rows.push(
			dataRow({ path: "known://big", body: fatKnown }),
			dataRow({ path: "repo://manifest", scheme: "repo", body: "manifest" }),
		);
		const _result = await budget.enforce({
			contextSize: 1000,
			messages: [
				{ role: "system", content: "sys" },
				{ role: "user", content: fatKnown },
			],
			rows,
			ctx: { runId: 1, turn: 1, loopId: 1, mode: "ask" },
			rummy,
		});
		// No layer 1 fire (no prior turn). Layer 2 archived known://big.
		const archivedPaths = setCalls
			.filter((c) => c.visibility === "archived")
			.map((c) => c.path);
		assert.deepEqual(archivedPaths, ["known://big"]);
		assert.equal(emitted.length, 1);
		assert.equal(
			emitted[0].soft,
			true,
			"turn 1 is the unfair-strike exception",
		);
		assert.match(
			emitted[0].message,
			/^Budget overflow: index archived \(repo:\/\/manifest preserved\)\.$/,
			"turn 1 body has no log glob (no prior turn to archive)",
		);
	});

	it("layer 2 still overflows: hard fail returned, single emit", async () => {
		const budget = makeBudget();
		const fatSys = "S".repeat(5000);
		const { rummy, emitted, setCalls, rows } = makeRummy({
			systemContent: fatSys,
		});
		// No log entries, no archivable catalog — packet is pure static system.
		const result = await budget.enforce({
			contextSize: 1000,
			messages: [
				{ role: "system", content: fatSys },
				{ role: "user", content: "u" },
			],
			rows,
			ctx: { runId: 1, turn: 2, loopId: 1, mode: "ask" },
			rummy,
		});
		assert.equal(result.ok, false);
		assert.ok(result.overflow > 0);
		assert.equal(emitted.length, 1, "single 413 even after layer 2 miss");
		assert.equal(emitted[0].status, 413);
		assert.equal(emitted[0].soft, false, "turn 2 hard fail strikes");
	});

	it("returns ok with no contextSize (gate disabled)", async () => {
		const budget = makeBudget();
		const result = await budget.enforce({
			contextSize: null,
			messages: [{ role: "system", content: "anything" }],
			rows: [],
		});
		assert.equal(result.ok, true);
		assert.equal(result.assembledTokens, 0);
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

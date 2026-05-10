/**
 * log plugin: tokens= invariant.
 *
 * The `tokens=` attr on every tag rendered inside <log> reflects the
 * log entry's own body weight in tokens. Empty-body recaps (slim
 * manifests for sh/mv/cp/rm/ask_user) omit tokens entirely. Body-bearing
 * recaps (get retrieval, set emission, search results, error, update)
 * surface their body's tokens.
 */
import assert from "node:assert";
import { describe, it } from "node:test";
import createHooks from "../../hooks/Hooks.js";
import PluginContext from "../../hooks/PluginContext.js";
import Log from "./log.js";

function makeHooks() {
	const hooks = createHooks();
	const core = new PluginContext("log", hooks);
	new Log(core);
	return hooks;
}

function logRow({
	turn = 1,
	action,
	slug,
	body = "",
	tokens = 0,
	state = "resolved",
	outcome = null,
	attrs = {},
}) {
	return {
		ordinal: 0,
		path: `log://turn_${turn}/${action}/${slug}`,
		scheme: "log",
		visibility: "indexed",
		state,
		outcome,
		body,
		vTokens: tokens,
		aTokens: tokens,
		vLines: 0,
		attributes: JSON.stringify({ action, ...attrs }),
		category: "logging",
		source_turn: turn,
	};
}

async function render(rows) {
	const hooks = makeHooks();
	const out = await hooks.assembly.user.filter("", { rows });
	return out;
}

describe("log plugin tokens= invariant", () => {
	it("<get> tokens= reports retrieved-content tokens (the log body)", async () => {
		const getLog = logRow({
			action: "get",
			slug: "auth_js",
			body: "export async function login(req, res) { ... }",
			tokens: 1240,
			attrs: { path: "src/auth.js" },
		});
		const out = await render([getLog]);
		assert.match(out, /"action":"get"[^}]*"tokens":1240/);
	});

	it("<set> tokens= reports emission tokens (the log body)", async () => {
		const setLog = logRow({
			action: "set",
			slug: "known%3A%2F%2Ffact",
			body: "<<NEW\nthe fact body\nNEW",
			tokens: 40,
			attrs: { path: "known://fact" },
		});
		const out = await render([setLog]);
		assert.match(out, /"action":"set"[^}]*"tokens":40/);
	});

	it("<search> tokens= is the log body tokens (results listing)", async () => {
		const searchLog = logRow({
			action: "search",
			slug: "query",
			body: "* https://a.com - 80 tokens\n* https://b.com - 120 tokens",
			tokens: 204,
			attrs: { query: "query" },
		});
		const out = await render([searchLog]);
		assert.match(out, /"action":"search"[^}]*"tokens":204/);
	});

	it("<update> tokens= is the log body tokens", async () => {
		const updateLog = logRow({
			action: "update",
			slug: "done",
			body: "Fixed it",
			tokens: 8,
			attrs: { status: 200 },
		});
		const out = await render([updateLog]);
		assert.match(out, /"action":"update"[^}]*"tokens":8/);
	});

	it("<error> tokens= is the log body tokens", async () => {
		const errLog = logRow({
			action: "error",
			slug: "overflow",
			body: "Token Budget overflow: packet was 40623 tokens...",
			tokens: 54,
			attrs: { status: 413 },
			state: "failed",
			outcome: "status:413",
		});
		const out = await render([errLog]);
		assert.match(out, /"action":"error"[^}]*"tokens":54/);
	});

	it("<sh> recap is slim (empty body) — tokens omitted", async () => {
		const shLog = logRow({
			action: "sh",
			slug: "echo",
			body: "",
			tokens: 0,
			attrs: { command: "echo hi" },
		});
		const out = await render([shLog]);
		assert.match(out, /"action":"sh"/);
		assert.doesNotMatch(out, /"action":"sh"[^}]*"tokens":/);
	});

	it("<env> recap is slim — tokens omitted", async () => {
		const envLog = logRow({
			action: "env",
			slug: "pwd",
			body: "",
			tokens: 0,
			attrs: { command: "pwd" },
		});
		const out = await render([envLog]);
		assert.match(out, /"action":"env"/);
		assert.doesNotMatch(out, /"action":"env"[^}]*"tokens":/);
	});

	it("<get> slice render: lines= attr + slice tokens (the slice body)", async () => {
		const sliceLog = logRow({
			action: "get",
			slug: "page",
			body: "[lines 1–50 / 262 total]\n…slice…",
			tokens: 200,
			attrs: {
				path: "https://example.com/page",
				lineStart: 1,
				lineEnd: 50,
				totalLines: 262,
			},
		});
		const out = await render([sliceLog]);
		assert.match(out, /"action":"get"[^}]*"lines":"1-50\/262"/);
		assert.match(out, /"action":"get"[^}]*"tokens":200/);
	});
});

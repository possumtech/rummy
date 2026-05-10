import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Env from "./env.js";

describe("Env", () => {
	const plugin = new Env({
		registerScheme() {},
		on() {},
		filter() {},
	});

	it("full returns raw emission for action log entries (line-numbering happens in materializeContext)", () => {
		const result = plugin.full({
			path: "log://turn_3/env/node",
			attributes: { command: "node --version" },
			body: "<env>node --version</env>",
		});
		assert.equal(result, "<env>node --version</env>");
	});

	it("full returns empty for empty stream body", () => {
		assert.strictEqual(
			plugin.full({
				path: "env://turn_3/foo_1",
				attributes: {},
				body: "",
			}),
			"",
		);
	});

	it("full returns stream body verbatim when total lines <= tail limit", () => {
		const out = plugin.full({
			path: "env://turn_3/ls_1",
			attributes: { command: "ls -F", channel: 1 },
			body: "a.out*\nhi.c\n",
		});
		assert.equal(out, "a.out*\nhi.c\n");
	});

	it("full tail-truncates long stream bodies to last 20 lines", () => {
		const lines = Array.from({ length: 50 }, (_, i) => `line${i + 1}`);
		const out = plugin.full({
			path: "env://turn_3/find_1",
			attributes: { command: "find /", channel: 1 },
			body: `${lines.join("\n")}\n`,
		});
		assert.ok(out.includes("line50"));
		assert.ok(out.includes("line31"));
		assert.ok(!out.includes("line30"));
	});
});

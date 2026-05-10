import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Sh from "./sh.js";

describe("Sh", () => {
	const plugin = new Sh({
		registerScheme() {},
		on() {},
		filter() {},
	});

	it("full tab-indents the model's emission for action log entries", () => {
		const result = plugin.full({
			path: "log://turn_3/sh/ls",
			attributes: { command: "ls -la" },
			body: "<sh>ls -la</sh>",
		});
		assert.equal(result, "\t<sh>ls -la</sh>");
	});

	it("full returns empty for empty stream body", () => {
		assert.strictEqual(
			plugin.full({
				path: "sh://turn_3/ls_1",
				attributes: {},
				body: "",
			}),
			"",
		);
	});

	it("full returns stream body verbatim when total lines <= tail limit", () => {
		const out = plugin.full({
			path: "sh://turn_3/ls_1",
			attributes: { command: "ls -la", channel: 1 },
			body: "file1\nfile2\n",
		});
		assert.equal(out, "file1\nfile2\n");
	});

	it("full tail-truncates long stream bodies to last 20 lines", () => {
		const lines = Array.from({ length: 50 }, (_, i) => `line${i + 1}`);
		const out = plugin.full({
			path: "sh://turn_3/rg_1",
			attributes: { command: "rg foo", channel: 1 },
			body: `${lines.join("\n")}\n`,
		});
		assert.ok(out.includes("line50"));
		assert.ok(out.includes("line31"));
		assert.ok(!out.includes("line30"));
	});
});

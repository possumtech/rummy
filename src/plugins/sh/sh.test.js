import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Sh from "./sh.js";

describe("Sh", () => {
	const plugin = new Sh({
		registerScheme() {},
		on() {},
		filter() {},
	});

	it("full renders command and body", () => {
		const result = plugin.full({
			attributes: { command: "ls -la" },
			body: "file1\nfile2",
		});
		assert.ok(result.includes("ls -la"));
		assert.ok(result.includes("file1"));
	});

	it("summary returns command", () => {
		assert.strictEqual(plugin.summary({ attributes: { command: "ls" } }), "ls");
	});
});

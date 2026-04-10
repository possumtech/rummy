import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Cp from "./cp.js";

describe("Cp", () => {
	const plugin = new Cp({
		registerScheme() {},
		on() {},
		filter() {},
	});

	it("full renders cp from and to", () => {
		const result = plugin.full({ attributes: { from: "a", to: "b" } });
		assert.ok(result.includes("a"));
		assert.ok(result.includes("b"));
	});
});

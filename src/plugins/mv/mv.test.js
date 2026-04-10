import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Mv from "./mv.js";

describe("Mv", () => {
	const plugin = new Mv({
		registerScheme() {},
		on() {},
		filter() {},
	});

	it("full renders mv from and to", () => {
		const result = plugin.full({ attributes: { from: "a", to: "b" } });
		assert.ok(result.includes("a"));
		assert.ok(result.includes("b"));
	});
});

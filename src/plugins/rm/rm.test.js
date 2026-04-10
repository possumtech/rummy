import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Rm from "./rm.js";

describe("Rm", () => {
	const plugin = new Rm({
		registerScheme() {},
		on() {},
		filter() {},
	});

	it("full renders rm path", () => {
		const result = plugin.full({ attributes: { path: "known://old" } });
		assert.ok(result.includes("known://old"));
	});

	it("summary renders rm path", () => {
		const result = plugin.summary({ attributes: { path: "known://old" } });
		assert.ok(result.includes("known://old"));
	});
});

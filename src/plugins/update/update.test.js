import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Update from "./update.js";

describe("Update", () => {
	const plugin = new Update({
		ensureTool() {},
		registerScheme() {},
		on() {},
		filter() {},
	});

	it("full returns body", () => {
		assert.ok(plugin.full({ body: "working" }).includes("working"));
	});

	it("summary returns full", () => {
		assert.ok(plugin.summary({ body: "working" }).includes("working"));
	});
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Summarize from "./summarize.js";

describe("Summarize", () => {
	const plugin = new Summarize({
		ensureTool() {},
		registerScheme() {},
		on() {},
		filter() {},
	});

	it("full returns body", () => {
		assert.ok(plugin.full({ body: "done" }).includes("done"));
	});

	it("summary returns full", () => {
		assert.ok(plugin.summary({ body: "done" }).includes("done"));
	});
});

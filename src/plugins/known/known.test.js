import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Known from "./known.js";

describe("Known", () => {
	const plugin = new Known({
		registerScheme() {},
		on() {},
		filter() {},
	});

	it("full returns body only (no prefix — tag attributes carry the path)", () => {
		const result = plugin.full({ path: "known://auth", body: "JWT tokens" });
		assert.strictEqual(result, "JWT tokens");
	});

	it("summary returns empty body — tag carries summary attribute", () => {
		const result = plugin.summary();
		assert.strictEqual(result, "");
	});
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import schemeOf from "./schemeOf.js";

describe("schemeOf", () => {
	it("extracts scheme from URI path", () => {
		assert.equal(schemeOf("known://users_dave"), "known");
		assert.equal(schemeOf("summary://run1_final"), "summary");
		assert.equal(schemeOf("write://output_txt"), "write");
		assert.equal(schemeOf("unknown://what_is_x"), "unknown");
	});

	it("returns null for bare file paths", () => {
		assert.equal(schemeOf("src/app.js"), null);
		assert.equal(schemeOf("readme.md"), null);
		assert.equal(schemeOf("path/to/file.txt"), null);
	});

	it("returns null for null/empty input", () => {
		assert.equal(schemeOf(null), null);
		assert.equal(schemeOf(""), null);
		assert.equal(schemeOf(undefined), null);
	});

	it("handles scheme with no suffix", () => {
		assert.equal(schemeOf("known://"), "known");
	});

	it("handles colons without double slash", () => {
		assert.equal(schemeOf("C:\\Users\\file"), null);
		assert.equal(schemeOf("key:value"), null);
	});

	it("handles multiple :// occurrences", () => {
		assert.equal(schemeOf("known://ref://nested"), "known");
	});
});

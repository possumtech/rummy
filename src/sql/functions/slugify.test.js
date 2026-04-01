import assert from "node:assert/strict";
import { describe, it } from "node:test";
import slugify from "./slugify.js";

describe("slugify", () => {
	it("lowercases and collapses whitespace to underscores", () => {
		assert.equal(slugify("Hello World"), "hello_world");
		assert.equal(slugify("  Multiple   Spaces  "), "multiple_spaces");
	});

	it("strips non-alphanumeric non-underscore characters", () => {
		assert.equal(slugify("What's the capital?"), "whats_the_capital");
		assert.equal(slugify("port=3000&host=localhost"), "port3000hostlocalhost");
	});

	it("collapses consecutive underscores", () => {
		assert.equal(slugify("a___b"), "a_b");
		assert.equal(slugify("a _ _ b"), "a_b");
	});

	it("trims leading and trailing underscores", () => {
		assert.equal(slugify("_hello_"), "hello");
		assert.equal(slugify("___test___"), "test");
	});

	it("truncates to 32 characters", () => {
		const long = "a".repeat(50);
		assert.equal(slugify(long).length, 32);
		assert.equal(slugify(long), "a".repeat(32));
	});

	it("truncates after transformation", () => {
		const long =
			"The Quick Brown Fox Jumps Over The Lazy Dog And Then Some More";
		const result = slugify(long);
		assert.ok(result.length <= 32);
		assert.ok(!result.endsWith("_"));
	});

	it("returns empty string for null/empty/undefined", () => {
		assert.equal(slugify(null), "");
		assert.equal(slugify(""), "");
		assert.equal(slugify(undefined), "");
	});

	it("preserves digits and underscores", () => {
		assert.equal(slugify("run_42_final"), "run_42_final");
		assert.equal(slugify("v2_config"), "v2_config");
	});

	it("handles pure punctuation", () => {
		assert.equal(slugify("!@#$%^&*()"), "");
	});

	it("handles unicode by stripping", () => {
		assert.equal(slugify("café résumé"), "caf_rsum");
	});
});

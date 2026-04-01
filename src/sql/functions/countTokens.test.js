import assert from "node:assert/strict";
import { describe, it } from "node:test";
import countTokens from "./countTokens.js";

describe("countTokens (SQL function wrapper)", () => {
	it("returns 0 for null/empty/undefined", () => {
		assert.equal(countTokens(null), 0);
		assert.equal(countTokens(""), 0);
		assert.equal(countTokens(undefined), 0);
	});

	it("returns positive integer for non-empty text", () => {
		const count = countTokens("Hello, world!");
		assert.ok(Number.isInteger(count));
		assert.ok(count > 0);
	});

	it("longer text produces more tokens", () => {
		const short = countTokens("hello");
		const long = countTokens("hello ".repeat(100));
		assert.ok(long > short);
	});

	it("single word is at least 1 token", () => {
		assert.ok(countTokens("word") >= 1);
	});

	it("handles code content", () => {
		const code = "const x = 42;\nfunction foo() { return x; }";
		const count = countTokens(code);
		assert.ok(count > 0);
	});

	it("handles whitespace-only text", () => {
		const count = countTokens("   \n\t  ");
		assert.ok(count > 0);
	});
});

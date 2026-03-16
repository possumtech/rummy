import assert from "node:assert";
import { describe, it } from "node:test";
import HeuristicMatcher from "./HeuristicMatcher.js";

describe("HeuristicMatcher", () => {
	it("should find an exact match", () => {
		const content = `function a() {
	console.log("a");
}`;
		const search = `function a() {
	console.log("a");
}`;
		const replace = `function a() {
	console.log("b");
}`;
		const result = HeuristicMatcher.matchAndPatch("test.js", content, search, replace);
		assert.strictEqual(result.error, null);
		assert.strictEqual(result.warning, null);
		assert.ok(result.patch.includes('+	console.log("b");'));
	});

	it("should heal indentation differences", () => {
		const content = `class Test {
	function a() {
		console.log("a");
	}
}`;
		// Model forgot the class indentation
		const search = `function a() {
	console.log("a");
}`;
		const replace = `function a() {
	console.log("b");
}`;
		const result = HeuristicMatcher.matchAndPatch("test.js", content, search, replace);
		assert.strictEqual(result.error, null);
		assert.ok(result.warning.includes("Indentation healing applied"));
		assert.ok(result.patch.includes('+\t\tconsole.log("b");')); // Should have 2 tabs now
	});

	it("should error on ambiguous match", () => {
		const content = `function a() {
	console.log("a");
}
function b() {
	console.log("a");
}`;
		const search = `	console.log("a");`;
		const replace = `	console.log("b");`;
		const result = HeuristicMatcher.matchAndPatch("test.js", content, search, replace);
		assert.ok(result.error);
		assert.ok(result.error.includes("multiple locations"));
	});
});

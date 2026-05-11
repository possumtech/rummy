import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMarkerBody } from "./marker.js";
import HeuristicMatcher, { generateSearchReplaceBody } from "./matcher.js";

describe("HeuristicMatcher", () => {
	describe("exact match", () => {
		it("replaces an exact match", () => {
			const file = "const x = 1;\nconst y = 2;\nconst z = 3;\n";
			const result = HeuristicMatcher.matchAndPatch(
				"test.js",
				file,
				"const y = 2;",
				"const y = 99;",
			);
			assert.equal(result.error, null);
			assert.equal(result.warning, null);
			assert.ok(result.patch);
			assert.ok(result.newContent.includes("const y = 99;"));
			assert.ok(!result.newContent.includes("const y = 2;"));
		});

		it("warns on multiple exact matches and applies to last", () => {
			const file = "a = 1;\na = 1;\na = 1;\n";
			const result = HeuristicMatcher.matchAndPatch(
				"test.js",
				file,
				"a = 1;",
				"a = 2;",
			);
			assert.equal(result.error, null);
			assert.ok(result.warning);
			assert.ok(result.warning.includes("matched"));
			assert.equal(result.newContent, "a = 1;\na = 1;\na = 2;\n");
		});

		it("reports match position (1-based line + counts)", () => {
			const file = "const x = 1;\nconst y = 2;\nconst z = 3;\n";
			const result = HeuristicMatcher.matchAndPatch(
				"test.js",
				file,
				"const y = 2;",
				"const y = 99;\nconst yy = 100;",
			);
			assert.equal(result.matchStartLine, 2);
			assert.equal(result.searchLineCount, 1);
			assert.equal(result.replaceLineCount, 2);
		});
	});

	describe("fuzzy match", () => {
		it("matches despite whitespace differences", () => {
			const file = "\tconst x = 1;\n\tconst y = 2;\n\tconst z = 3;\n";
			const result = HeuristicMatcher.matchAndPatch(
				"test.js",
				file,
				"const y = 2;",
				"const y = 99;",
			);
			assert.equal(result.error, null);
			assert.ok(result.patch);
			assert.ok(result.newContent.includes("const y = 99;"));
		});

		it("returns error when no match found", () => {
			const file = "const x = 1;\n";
			const result = HeuristicMatcher.matchAndPatch(
				"test.js",
				file,
				"const y = 999;",
				"const y = 0;",
			);
			assert.ok(result.error);
			assert.equal(result.patch, null);
		});

		it("warns on multiple fuzzy matches", () => {
			const file = "\ta = 1;\n\tb = 2;\n\ta = 1;\n\tc = 3;\n";
			const result = HeuristicMatcher.matchAndPatch(
				"test.js",
				file,
				"a = 1;",
				"a = 99;",
			);
			assert.equal(result.error, null);
			assert.ok(result.warning);
			assert.ok(result.warning.includes("matched"));
		});

		it("skips blank lines during matching", () => {
			const file = "function foo() {\n\n\treturn 1;\n}\n";
			const result = HeuristicMatcher.matchAndPatch(
				"test.js",
				file,
				"function foo() {\nreturn 1;\n}",
				"function foo() {\nreturn 2;\n}",
			);
			assert.equal(result.error, null);
			assert.ok(result.newContent.includes("return 2;"));
		});
	});

	describe("indentation healing", () => {
		it("heals indentation from search to file style", () => {
			const file = "\t\tconst x = 1;\n\t\tconst y = 2;\n";
			const result = HeuristicMatcher.matchAndPatch(
				"test.js",
				file,
				"const y = 2;",
				"const y = 99;",
			);
			assert.equal(result.error, null);
			assert.ok(result.warning);
			assert.ok(result.warning.includes("Indentation healing"));
			assert.ok(result.newContent.includes("\t\tconst y = 99;"));
		});

		it("preserves relative indentation in replace block", () => {
			const file = "    if (x) {\n        return 1;\n    }\n";
			const result = HeuristicMatcher.matchAndPatch(
				"test.js",
				file,
				"if (x) {\n    return 1;\n}",
				"if (x) {\n    return 2;\n    return 3;\n}",
			);
			assert.equal(result.error, null);
			assert.ok(result.newContent.includes("    return 2;"));
		});
	});

	describe("empty search", () => {
		it("appends to end of file on empty search tokens", () => {
			const file = "line1\n   \nline2\n";
			const result = HeuristicMatcher.matchAndPatch(
				"test.js",
				file,
				"   ",
				"line3",
			);
			assert.equal(result.error, null);
			assert.ok(result.newContent.includes("line3"));
		});

		it("adds newline before append if file lacks trailing newline", () => {
			const file = "line1";
			const result = HeuristicMatcher.matchAndPatch(
				"test.js",
				file,
				"  ",
				"line2",
			);
			assert.equal(result.error, null);
			assert.ok(result.newContent.includes("line1\nline2"));
		});
	});
});

describe("generateSearchReplaceBody", () => {
	it("returns empty string when content is unchanged", () => {
		assert.equal(generateSearchReplaceBody("same", "same"), "");
	});

	it("first-appearance: empty SEARCH + full REPLACE", () => {
		const body = generateSearchReplaceBody("", "hello\nworld\n");
		assert.equal(body, "<<SEARCH\nSEARCH<<REPLACE\nhello\nworld\n\nREPLACE");
		const { ops, error } = parseMarkerBody(body);
		assert.equal(error, null, "parseable by marker.js");
		assert.equal(ops.length, 1);
		assert.equal(ops[0].op, "search_replace");
		assert.equal(ops[0].search, "");
		assert.match(ops[0].replace, /hello\nworld/);
	});

	it("single-hunk edit: one SEARCH/REPLACE pair with hunk context", () => {
		const before = "line1\nline2\nold\nline4\nline5\n";
		const after = "line1\nline2\nnew\nline4\nline5\n";
		const body = generateSearchReplaceBody(before, after);
		const { ops, error } = parseMarkerBody(body);
		assert.equal(error, null);
		assert.equal(ops.length, 1);
		assert.equal(ops[0].op, "search_replace");
		assert.match(ops[0].search, /old/);
		assert.match(ops[0].replace, /new/);
		assert.doesNotMatch(ops[0].search, /new/);
		assert.doesNotMatch(ops[0].replace, /old/);
	});

	it("multi-hunk edit: one pair per hunk, parseable as multiple search_replace ops", () => {
		const before = Array.from({ length: 30 }, (_, i) => `line${i + 1}`).join(
			"\n",
		);
		const after = before
			.replace("line5", "FIVE")
			.replace("line25", "TWENTY_FIVE");
		const body = generateSearchReplaceBody(before, after);
		const { ops, error } = parseMarkerBody(body);
		assert.equal(error, null);
		assert.equal(ops.length, 2);
		assert.ok(ops.every((o) => o.op === "search_replace"));
		assert.match(ops[0].search, /line5/);
		assert.match(ops[0].replace, /FIVE/);
		assert.match(ops[1].search, /line25/);
		assert.match(ops[1].replace, /TWENTY_FIVE/);
	});
});

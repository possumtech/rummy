import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyModel, parseModel, renderClient, renderModel } from "./udiff.js";

describe("udiff: three siblings of one edit", () => {
	describe("renderClient (engine → client, full createTwoFilesPatch)", () => {
		it("emits Index/---/+++ banner with 3 lines of context", () => {
			const out = renderClient(
				"src/x.js",
				"const a = 1;\nconst b = 2;\nconst c = 3;\n",
				"const a = 1;\nconst B = 22;\nconst c = 3;\n",
			);
			assert.match(out, /^=+\n---/);
			assert.match(out, /\+\+\+ src\/x\.js/);
			assert.match(out, /@@ -1,3 \+1,3 @@/);
		});
	});

	describe("renderModel (engine → model, udifflite)", () => {
		it("emits hunks only, no banner, context: 0", () => {
			const out = renderModel(
				"const a = 1;\nconst b = 2;\nconst c = 3;\n",
				"const a = 1;\nconst B = 22;\nconst c = 3;\n",
			);
			assert.equal(out, "@@ -2,1 +2,1 @@\n-const b = 2;\n+const B = 22;");
		});

		it("returns empty string when content is unchanged", () => {
			assert.equal(renderModel("same", "same"), "");
			assert.equal(renderModel("", ""), "");
		});

		it("filters `\\ No newline at end of file` metadata noise", () => {
			const out = renderModel("a\nb", "a\nB");
			assert.ok(!out.includes("\\ No newline"));
		});
	});

	describe("parseModel (model → engine, udiffberg)", () => {
		it("body without leading @@ is raw NEW content", () => {
			const r = parseModel("hello\nworld\n");
			assert.deepEqual(r, { body: "hello\nworld\n" });
		});

		it("body with leading @@ parses as hunks", () => {
			const r = parseModel("@@ -1,1 +1,1 @@\n-old\n+new");
			assert.equal(r.hunks.length, 1);
			assert.equal(r.hunks[0].oldStart, 1);
			assert.deepEqual(r.hunks[0].lines, ["-old", "+new"]);
		});

		it("missing counts default to 1", () => {
			const r = parseModel("@@ -3 +3 @@\n-old\n+new");
			assert.equal(r.hunks[0].oldLines, 1);
			assert.equal(r.hunks[0].newLines, 1);
		});

		it("multi-hunk: each @@ starts a new hunk", () => {
			const r = parseModel("@@ -1,1 +1,1 @@\n-a\n+A\n@@ -5,1 +5,1 @@\n-e\n+E");
			assert.equal(r.hunks.length, 2);
		});

		it("malformed @@ header → error", () => {
			const r = parseModel("@@ garbled @@\n-x\n+y");
			assert.match(r.error, /bad hunk header/);
		});

		it("empty input → raw empty body", () => {
			assert.deepEqual(parseModel(""), { body: "" });
			assert.deepEqual(parseModel(null), { body: "" });
		});
	});

	describe("applyModel (strict-then-Hedberg fallback)", () => {
		it("strict path: correct @@ coords land exactly", () => {
			const r = applyModel(
				"a\nb\nc\n",
				parseModel("@@ -2,1 +2,1 @@\n-b\n+B").hunks,
			);
			assert.equal(r.newBody, "a\nB\nc\n");
			assert.equal(r.opPositions[0].kind, "search_replace");
			assert.equal(r.opPositions[0].startLine, 2);
		});

		it("Hedberg fallback: wrong @@ coords but content matches", () => {
			const r = applyModel(
				"a\nb\nc\nd\ne\n",
				// Model says line 1 but content is at line 3.
				parseModel("@@ -1,1 +1,1 @@\n-c\n+CC").hunks,
			);
			assert.equal(r.newBody, "a\nb\nCC\nd\ne\n");
			assert.equal(r.opPositions[0].startLine, 3, "rescue found the real line");
		});

		it("pure insert (no - lines) from empty body", () => {
			const r = applyModel(
				"",
				parseModel("@@ -0,0 +1,2 @@\n+hello\n+world").hunks,
			);
			assert.equal(r.newBody, "hello\nworld");
			assert.equal(r.opPositions[0].kind, "new");
		});

		it("pure delete (no + lines)", () => {
			const r = applyModel(
				"keep\ndrop\nkeep\n",
				parseModel("@@ -2,1 +2,0 @@\n-drop").hunks,
			);
			assert.equal(r.newBody, "keep\nkeep\n");
			assert.equal(r.opPositions[0].kind, "delete");
		});

		it("multi-hunk: hunks apply sequentially", () => {
			const r = applyModel(
				"one\ntwo\nthree\nfour\nfive\n",
				parseModel("@@ -1,1 +1,1 @@\n-one\n+ONE\n@@ -5,1 +5,1 @@\n-five\n+FIVE")
					.hunks,
			);
			assert.equal(r.newBody, "ONE\ntwo\nthree\nfour\nFIVE\n");
			assert.equal(r.opPositions.length, 2);
		});

		it("unrescuable conflict reports attempted + currentBody", () => {
			const r = applyModel(
				"actual content\n",
				parseModel("@@ -1,1 +1,1 @@\n-absent\n+x").hunks,
			);
			assert.ok(r.error);
			assert.equal(r.attempted, "absent");
			assert.equal(r.currentBody, "actual content\n");
		});

		it("context lines (space-prefixed) ride along as both search AND replace", () => {
			const r = applyModel(
				"a\nb\nc\n",
				parseModel("@@ -1,3 +1,3 @@\n a\n-b\n+B\n c").hunks,
			);
			assert.equal(r.newBody, "a\nB\nc\n");
		});
	});

	describe("regression: stray-backslash escape on hunk lines", () => {
		it("models sometimes emit `\\+content` (escaped); applier strips the stray \\", () => {
			// Observed gemma emission. The parser must not eat the line
			// (which would silently drop the entire hunk into a no-op).
			const r = applyModel(
				"",
				parseModel("@@ -0,0 +1,2 @@\n\\+hello\n\\+world").hunks,
			);
			assert.equal(r.newBody, "hello\nworld");
		});

		it("`\\ No newline at end of file` metadata is still filtered", () => {
			// Only the exact `\ ` (backslash-space) shape is metadata.
			const out = renderModel("a\nb", "a\nB");
			assert.ok(!out.includes("\\ No newline"));
		});
	});

	describe("round-trip: renderModel + parseModel + applyModel", () => {
		it("recovers the new content from a model-shaped udiff", () => {
			const old = "alpha\nbeta\ngamma\n";
			const neu = "alpha\nBETA\ngamma\n";
			const lite = renderModel(old, neu);
			const parsed = parseModel(lite);
			const applied = applyModel(old, parsed.hunks);
			assert.equal(applied.newBody, neu);
		});
	});
});

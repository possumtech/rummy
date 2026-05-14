import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderClient, renderModel } from "./udiff.js";

describe("udiff: render-only siblings", () => {
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
});

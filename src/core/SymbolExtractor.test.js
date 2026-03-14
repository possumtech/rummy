import assert from "node:assert";
import { describe, it } from "node:test";
import SymbolExtractor from "./SymbolExtractor.js";

describe("SymbolExtractor", () => {
	const extractor = new SymbolExtractor();

	it("should extract JS definitions and references", () => {
		const code = `
			class MyClass {
				myMethod(a, b) {
					otherFunc();
				}
			}
			function topLevel(x) {}
		`;
		const result = extractor.extract(code, "js");
		assert.ok(result);

		const classDef = result.definitions.find((d) => d.name === "MyClass");
		assert.strictEqual(classDef.type, "class");

		const methodDef = result.definitions.find((d) => d.name === "myMethod");
		assert.strictEqual(methodDef.type, "method");
		assert.strictEqual(methodDef.params, "(a, b)");

		const funcDef = result.definitions.find((d) => d.name === "topLevel");
		assert.strictEqual(funcDef.type, "function");

		assert.ok(result.references.includes("otherFunc"));
	});

	it("should extract CSS selectors", () => {
		const code = `
			.my-class { color: red; }
			#my-id { margin: 0; }
		`;
		const result = extractor.extract(code, "css");
		assert.ok(result);
		assert.ok(
			result.definitions.some(
				(d) => d.name === "my-class" && d.type === "class",
			),
		);
		assert.ok(
			result.definitions.some((d) => d.name === "my-id" && d.type === "id"),
		);
	});

	it("should return null for unsupported languages", () => {
		const result = extractor.extract("some code", "txt");
		assert.strictEqual(result, null);
	});
});

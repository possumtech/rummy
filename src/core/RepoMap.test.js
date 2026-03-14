import assert from "node:assert";
import fs from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import RepoMap from "./RepoMap.js";

describe("RepoMap (Perspective Engine)", () => {
	const testDir = join(process.cwd(), "test_perspective");

	before(async () => {
		await fs.mkdir(testDir, { recursive: true });
		// Active file references 'DepClass'
		await fs.writeFile(
			join(testDir, "active.js"),
			"const x = new DepClass();",
		);
		// Dependency file defines 'DepClass' and a method
		await fs.writeFile(
			join(testDir, "dependency.js"),
			"export class DepClass { method(a) {} }",
		);
	});

	after(async () => {
		await fs.rm(testDir, { recursive: true, force: true });
	});

	it("should build a static index and render a dynamic perspective", async () => {
		const mockCtx = {
			root: testDir,
			getMappableFiles: async () => ["active.js", "dependency.js"],
		};

		const repoMap = new RepoMap(mockCtx);
		
		// 1. Build the Static Index (Definitions only)
		const index = await repoMap.updateIndex();
		assert.strictEqual(index.length, 2);
		
		const depEntry = index.find(f => f.path === "dependency.js");
		assert.ok(depEntry.symbols.some(s => s.name === "DepClass"));
		assert.ok(depEntry.symbols.some(s => s.name === "method"));

		// 2. Render Perspective with 'active.js' focus
		const perspective = repoMap.renderPerspective(index, ["active.js"]);

		const activeFile = perspective.files.find(f => f.path === "active.js");
		const depFile = perspective.files.find(f => f.path === "dependency.js");

		// Active files are Hot by default
		assert.strictEqual(activeFile.mode, "hot", "Active file should be hot");
		
		// Dependency should be promoted to Hot because DepClass was referenced
		assert.strictEqual(depFile.mode, "hot", "Referenced dependency should be promoted to hot");
		
		// All symbols in a Hot file should retain their detail
		const methodSymbol = depFile.symbols.find(s => s.name === "method");
		assert.strictEqual(methodSymbol.params, "(a)", "Method in hot file should retain parameters");
		assert.ok(methodSymbol.line, "Method in hot file should retain line number");
	});
});

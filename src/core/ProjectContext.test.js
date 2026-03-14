import assert from "node:assert";
import fs from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it, mock } from "node:test";
import GitProvider from "./GitProvider.js";
import ProjectContext, { FileState } from "./ProjectContext.js";

describe("ProjectContext", () => {
	const testDir = join(process.cwd(), "test_context_unit");

	before(async () => {
		await fs.mkdir(testDir, { recursive: true });
		await fs.writeFile(join(testDir, "file.js"), "content");
		await fs.mkdir(join(testDir, "node_modules"), { recursive: true });
		await fs.writeFile(join(testDir, "node_modules/secret.txt"), "secret");
	});

	after(async () => {
		mock.restoreAll();
		await fs.rm(testDir, { recursive: true, force: true });
	});

	it("should handle git projects", async () => {
		mock.method(GitProvider, "detectRoot", async (_path) => testDir);
		mock.method(
			GitProvider,
			"getTrackedFiles",
			async () => new Set(["file.js"]),
		);
		mock.method(GitProvider, "isIgnored", async (_root, path) =>
			path.includes("node_modules"),
		);

		const ctx = await ProjectContext.open(testDir);
		assert.strictEqual(ctx.isGit, true);
		assert.strictEqual(await ctx.resolveState("file.js"), FileState.MAPPABLE);
		assert.strictEqual(
			await ctx.resolveState("node_modules/secret.txt"),
			FileState.IGNORED,
		);

		const mappable = await ctx.getMappableFiles();
		assert.ok(mappable.includes("file.js"));
	});

	it("should handle non-git fallback", async () => {
		mock.method(GitProvider, "detectRoot", async () => null);

		const ctx = await ProjectContext.open(testDir);
		assert.strictEqual(ctx.isGit, false);

		assert.strictEqual(await ctx.resolveState("file.js"), FileState.MAPPABLE);
		assert.strictEqual(
			await ctx.resolveState("node_modules/secret.txt"),
			FileState.IGNORED,
		);

		const mappable = await ctx.getMappableFiles();
		assert.ok(mappable.includes("file.js"));
		assert.ok(!mappable.includes("node_modules/secret.txt"));
	});

	it("should handle .snore.json with read_only", async () => {
		mock.method(GitProvider, "detectRoot", async () => testDir);
		const config = {
			read_only: ["file.js"],
			ignored: ["other.js"],
		};
		await fs.writeFile(join(testDir, ".snore.json"), JSON.stringify(config));

		const ctx = await ProjectContext.open(testDir);
		assert.strictEqual(await ctx.resolveState("file.js"), FileState.READ_ONLY);
		assert.strictEqual(await ctx.resolveState("other.js"), FileState.IGNORED);

		await fs.unlink(join(testDir, ".snore.json"));
	});
});

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
		await fs.mkdir(join(testDir, "some_dir"), { recursive: true });
		await fs.writeFile(join(testDir, "some_dir/file2.js"), "content");
	});

	after(async () => {
		mock.restoreAll();
		await fs.rm(testDir, { recursive: true, force: true });
	});

	it("should handle git projects", async () => {
		mock.method(GitProvider, "detectRoot", async () => testDir);
		mock.method(
			GitProvider,
			"getTrackedFiles",
			async () => new Set(["file.js"]),
		);
		mock.method(GitProvider, "isIgnored", async (_root, path) =>
			path.includes("some_dir"),
		);

		const ctx = await ProjectContext.open(testDir);
		assert.strictEqual(ctx.isGit, true);
		assert.strictEqual(await ctx.resolveState("file.js"), FileState.MAPPABLE);
		assert.strictEqual(
			await ctx.resolveState("some_dir/file2.js"),
			FileState.IGNORED,
		);

		const mappable = await ctx.getMappableFiles();
		assert.ok(mappable.includes("file.js"));
	});

	it("should handle non-git restrictive mapping", async () => {
		mock.method(GitProvider, "detectRoot", async () => null);

		const ctx = await ProjectContext.open(testDir);
		assert.strictEqual(ctx.isGit, false);

		// Implicitly ignored
		assert.strictEqual(await ctx.resolveState("file.js"), FileState.IGNORED);

		const mappable = await ctx.getMappableFiles();
		assert.strictEqual(mappable.length, 0);
	});

	it("should respect explicit DB visibility in non-git", async () => {
		mock.method(GitProvider, "detectRoot", async () => null);

		const visibility = new Map([
			["file.js", FileState.ACTIVE],
			["some_dir/file2.js", FileState.MAPPABLE],
		]);
		const ctx = await ProjectContext.open(testDir, visibility);

		assert.strictEqual(await ctx.resolveState("file.js"), FileState.ACTIVE);
		assert.strictEqual(
			await ctx.resolveState("some_dir/file2.js"),
			FileState.MAPPABLE,
		);

		const mappable = await ctx.getMappableFiles();
		assert.strictEqual(mappable.length, 2);
	});
});

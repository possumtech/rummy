import assert from "node:assert";
import fs from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import FsProvider from "./FsProvider.js";

describe("FsProvider", () => {
	const testDir = join(process.cwd(), "test_fs_provider");

	before(async () => {
		await fs.mkdir(testDir, { recursive: true });
		await fs.writeFile(join(testDir, "file1.txt"), "hello");
		await fs.mkdir(join(testDir, "subdir"), { recursive: true });
		await fs.writeFile(join(testDir, "subdir", "file2.txt"), "world");
		await fs.mkdir(join(testDir, ".git"), { recursive: true });
		await fs.writeFile(join(testDir, ".git", "config"), "git info");
	});

	after(async () => {
		await fs.rm(testDir, { recursive: true, force: true });
	});

	it("should list files recursively and respect ignores", () => {
		const files = FsProvider.listFiles(testDir);
		assert.ok(files.includes("file1.txt"));
		assert.ok(files.includes("subdir/file2.txt"));
		assert.ok(!files.includes(".git/config"), "Should ignore .git directory");
	});

	it("should get mtime for a file", () => {
		const mtime = FsProvider.getMtime(join(testDir, "file1.txt"));
		assert.ok(typeof mtime === "number");
		assert.ok(mtime > 0);
	});

	it("should return 0 for non-existent file mtime", () => {
		const mtime = FsProvider.getMtime(join(testDir, "non-existent.txt"));
		assert.strictEqual(mtime, 0);
	});
});

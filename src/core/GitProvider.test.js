import assert from "node:assert";
import { describe, it, mock } from "node:test";
import git from "isomorphic-git";
import GitProvider from "./GitProvider.js";

describe("GitProvider", () => {
	it("should detect root correctly", async () => {
		mock.method(git, "findRoot", async () => "/repo/root");
		const root = await GitProvider.detectRoot("/repo/root/subdir");
		assert.strictEqual(root, "/repo/root");
	});

	it("should return null if no root detected", async () => {
		mock.method(git, "findRoot", async () => {
			throw new Error("no root");
		});
		const root = await GitProvider.detectRoot("/outside");
		assert.strictEqual(root, null);
	});

	it("should list tracked files", async () => {
		mock.method(git, "listFiles", async () => ["file1.js", "file2.js"]);
		const files = await GitProvider.getTrackedFiles("/repo");
		assert.ok(files instanceof Set);
		assert.ok(files.has("file1.js"));
		assert.strictEqual(files.size, 2);
	});

	it("should return empty set if listFiles fails", async () => {
		mock.method(git, "listFiles", async () => {
			throw new Error("fail");
		});
		const files = await GitProvider.getTrackedFiles("/repo");
		assert.strictEqual(files.size, 0);
	});

	it("should check if file is ignored", async () => {
		mock.method(git, "isIgnored", async () => true);
		const ignored = await GitProvider.isIgnored("/repo", "ignored.js");
		assert.strictEqual(ignored, true);
	});

	it("should return false if isIgnored fails", async () => {
		mock.method(git, "isIgnored", async () => {
			throw new Error("fail");
		});
		const ignored = await GitProvider.isIgnored("/repo", "f.js");
		assert.strictEqual(ignored, false);
	});

	it("should get HEAD hash", async () => {
		mock.method(git, "resolveRef", async () => "abc123hash");
		const hash = await GitProvider.getHeadHash("/repo");
		assert.strictEqual(hash, "abc123hash");
	});

	it("should return null if resolveRef fails", async () => {
		mock.method(git, "resolveRef", async () => {
			throw new Error("fail");
		});
		const hash = await GitProvider.getHeadHash("/repo");
		assert.strictEqual(hash, null);
	});
});

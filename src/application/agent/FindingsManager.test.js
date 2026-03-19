import test from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import { join } from "node:path";
import FindingsManager from "./FindingsManager.js";
import ResponseParser from "./ResponseParser.js";

test("FindingsManager", async (t) => {
	const mockDb = {
		get_findings_by_run_id: { all: async () => [] },
		update_finding_diff_status: { run: async () => {} },
		update_finding_command_status: { run: async () => {} },
		update_finding_notification_status: { run: async () => {} },
		insert_finding_diff: { run: async () => {} },
		insert_finding_command: { run: async () => {} },
		insert_finding_notification: { run: async () => {} },
	};
	const parser = new ResponseParser();
	const manager = new FindingsManager(mockDb, parser);

	await t.test("populateFindings should extract diffs from tags", async () => {
		const atomicResult = { runId: "r1", diffs: [], commands: [], notifications: [], content: "" };
		const tags = [
			{ tagName: "create", attrs: [{ name: "file", value: "new.txt" }], isMock: true, childNodes: [{ value: "content" }] }
		];
		await manager.populateFindings("/tmp", atomicResult, tags);
		assert.strictEqual(atomicResult.diffs.length, 1);
		assert.strictEqual(atomicResult.diffs[0].file, "new.txt");
		assert.strictEqual(atomicResult.diffs[0].patch, "content");
	});

	await t.test("populateFindings should extract various tags", async () => {
		const atomicResult = { runId: "r1", diffs: [], commands: [], notifications: [], content: "RUMMY_TEST_DIFF RUMMY_TEST_NOTIFY" };
		const tags = [
			{ tagName: "short", isMock: true, childNodes: [{ value: "short text" }] },
			{ tagName: "edit", attrs: [{ name: "file", value: "edit.js" }], isMock: true, childNodes: [{ value: "patch" }] },
			{ tagName: "delete", attrs: [{ name: "file", value: "del.js" }], isMock: true },
			{ tagName: "prompt_user", isMock: true, childNodes: [{ value: "Question?" }] },
			{ tagName: "summary", isMock: true, childNodes: [{ value: "Sum" }] },
			{ tagName: "analysis", isMock: true, childNodes: [{ value: "Ana" }] }
		];
		await manager.populateFindings("/tmp", atomicResult, tags);
		assert.strictEqual(atomicResult.notifications.length, 4); // short, prompt_user, summary, and RUMMY_TEST_NOTIFY
		assert.strictEqual(atomicResult.diffs.length, 3); // edit, delete, and RUMMY_TEST_DIFF
		assert.strictEqual(atomicResult.analysis, "Ana");
	});

	await t.test("resolveOutstandingFindings should handle all categories", async (t) => {
		const runId = "r1";
		const projectPath = "/tmp";
		const findings = [
			{ id: 1, category: "diff", status: "proposed", type: "create", file: "res.txt", patch: "done" },
			{ id: 2, category: "command", status: "proposed", type: "run", command: "ls" },
			{ id: 3, category: "notification", status: "proposed", type: "prompt_user", text: "OK?" }
		];
		mockDb.get_findings_by_run_id.all = async () => findings;
		
		const originalApply = manager.applyDiff;
		manager.applyDiff = async () => {};
		t.after(() => manager.applyDiff = originalApply);

		const infoTags = [
			{ tagName: "info", attrs: [{ name: "diff", value: "1" }], isMock: true, childNodes: [{ value: "accepted" }] },
			{ tagName: "info", attrs: [{ name: "command", value: "2" }], isMock: true, childNodes: [{ value: "rejected" }] },
			{ tagName: "info", attrs: [{ name: "notification", value: "3" }], isMock: true, childNodes: [{ value: "yes" }] }
		];

		const result = await manager.resolveOutstandingFindings(projectPath, runId, "prompt", infoTags);
		assert.strictEqual(result.resolvedCount, 3);
	});

	await t.test("applyDiff should handle create type", async (t) => {
		const projectPath = join(process.cwd(), "test_apply_diff");
		await fs.mkdir(projectPath, { recursive: true });
		t.after(async () => await fs.rm(projectPath, { recursive: true, force: true }));

		const diff = { type: "create", file: "hello.txt", patch: "world" };
		await manager.applyDiff(projectPath, diff);

		const content = await fs.readFile(join(projectPath, "hello.txt"), "utf8");
		assert.strictEqual(content, "world");
	});
});

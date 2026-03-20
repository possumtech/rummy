import test from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import { join } from "node:path";
import FindingsManager from "./FindingsManager.js";
import ResponseParser from "./ResponseParser.js";

test("FindingsManager", async (t) => {
	const mockDb = {
		get_findings_by_run_id: { all: async () => [] },
		get_unresolved_findings: { all: async () => [] },
		get_project_by_path: { all: async () => [{ id: "p1" }] },
		set_retained: { run: async () => {} },
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
			{ tagName: "read", attrs: [{ name: "file", value: "read.js" }], isMock: true },
			{ tagName: "drop", attrs: [{ name: "file", value: "drop.js" }], isMock: true },
			{ tagName: "run", isMock: true, childNodes: [{ value: "npm test" }] },
			{ tagName: "env", isMock: true, childNodes: [{ value: "NODE_ENV=test" }] },
			{ tagName: "short", isMock: true, childNodes: [{ value: "short text" }] },
			{ tagName: "edit", attrs: [{ name: "file", value: "edit.js" }], isMock: true, childNodes: [{ value: "patch" }] },
			{ tagName: "delete", attrs: [{ name: "file", value: "del.js" }], isMock: true },
			{ tagName: "prompt_user", isMock: true, childNodes: [{ value: "Question?" }] },
			{ tagName: "summary", isMock: true, childNodes: [{ value: "Sum" }] },
			{ tagName: "analysis", isMock: true, childNodes: [{ value: "Ana" }] }
		];

		let retainedCalls = [];
		mockDb.set_retained.run = async (params) => { retainedCalls.push(params); };

		await manager.populateFindings("/tmp", atomicResult, tags);

		// Assertions for persistence tags
		assert.deepStrictEqual(retainedCalls, [
			{ project_id: "p1", path: "read.js", is_retained: 1 },
			{ project_id: "p1", path: "drop.js", is_retained: 0 }
		]);

		// Assertions for command tags
		assert.strictEqual(atomicResult.commands.length, 2);
		assert.strictEqual(atomicResult.commands[0].command, "npm test");
		assert.strictEqual(atomicResult.commands[1].command, "NODE_ENV=test");

		// Assertions for notification tags
		assert.strictEqual(atomicResult.notifications.length, 4); // short, prompt_user, summary, and RUMMY_TEST_NOTIFY
		assert.strictEqual(atomicResult.notifications[0].type, "short");
		assert.strictEqual(atomicResult.notifications[1].type, "prompt_user");
		assert.strictEqual(atomicResult.notifications[2].type, "summary");
		
		// Assertions for diff tags
		assert.strictEqual(atomicResult.diffs.length, 3); // edit, delete, and the one from RUMMY_TEST_DIFF
		// Note: populateFindings appends to atomicResult.diffs
		assert.ok(atomicResult.diffs.find(d => d.file === "edit.js"));
		assert.ok(atomicResult.diffs.find(d => d.file === "del.js"));
		assert.ok(atomicResult.diffs.find(d => d.file === "rummy_test.txt"));

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
		
		let updateCalls = [];
		mockDb.get_unresolved_findings.all = async () => findings;
		mockDb.update_finding_diff_status.run = async (p) => updateCalls.push({ type: "diff", ...p });
		mockDb.update_finding_command_status.run = async (p) => updateCalls.push({ type: "command", ...p });
		mockDb.update_finding_notification_status.run = async (p) => updateCalls.push({ type: "notification", ...p });
		
		const originalApply = manager.applyDiff;
		manager.applyDiff = async () => {};
		t.after(() => manager.applyDiff = originalApply);

		const infoTags = [
			{ tagName: "info", attrs: [{ name: "diff", value: "1" }], isMock: true, childNodes: [{ value: "accepted" }] },
			{ tagName: "info", attrs: [{ name: "command", value: "2" }], isMock: true, childNodes: [{ value: "rejected" }] },
			{ tagName: "info", attrs: [{ name: "notification", value: "3" }], isMock: true, childNodes: [{ value: "responded" }] }
		];

		const result = await manager.resolveOutstandingFindings(projectPath, runId, "prompt", infoTags);
		assert.strictEqual(result.resolvedCount, 3);
		assert.strictEqual(updateCalls.length, 3);
		assert.ok(updateCalls.find(c => c.type === "diff" && c.status === "accepted"));
		assert.ok(updateCalls.find(c => c.type === "command" && c.status === "rejected"));
		assert.ok(updateCalls.find(c => c.type === "notification" && c.status === "responded"));
	});

	await t.test("applyDiff should handle create, delete, and edit types", async (t) => {
		const projectPath = join(process.cwd(), "test_apply_diff");
		await fs.mkdir(projectPath, { recursive: true });
		t.after(async () => await fs.rm(projectPath, { recursive: true, force: true }));

		// Create
		const diffCreate = { type: "create", file: "hello.txt", patch: "world" };
		await manager.applyDiff(projectPath, diffCreate);
		assert.strictEqual(await fs.readFile(join(projectPath, "hello.txt"), "utf8"), "world");

		// Edit (trusting patch for now)
		const diffEdit = { type: "edit", file: "hello.txt", patch: "updated world", search: "world", replace: "updated world" };
		await manager.applyDiff(projectPath, diffEdit);
		assert.strictEqual(await fs.readFile(join(projectPath, "hello.txt"), "utf8"), "updated world");

		// Delete
		const diffDelete = { type: "delete", file: "hello.txt" };
		await manager.applyDiff(projectPath, diffDelete);
		await assert.rejects(fs.access(join(projectPath, "hello.txt")));

		// Edit failure
		await fs.writeFile(join(projectPath, "fail.txt"), "some content", "utf8");
		const diffEditFail = { type: "edit", file: "fail.txt", patch: "", search: "some content", replace: "new content" };
		await assert.rejects(manager.applyDiff(projectPath, diffEditFail), /Failed to apply patch/);
	});
});

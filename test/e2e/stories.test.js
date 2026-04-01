/**
 * Story-driven E2E tests.
 *
 * Each test tells a story with a verifiable outcome. The story succeeds
 * when the model produces the correct answer, not when the RPC returns
 * a status code. These tests catch behavioral bugs that structural tests miss.
 *
 * Rules:
 * - Every test asserts on CONTENT, not just status
 * - Multi-turn tests verify the model answered the SECOND question
 * - Tests should fail when the model sees the wrong context
 */
import assert from "node:assert";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import TestDb from "../helpers/TestDb.js";
import TestServer from "../helpers/TestServer.js";
import AuditClient from "../helpers/AuditClient.js";

const model = process.env.RUMMY_MODEL_DEFAULT;
const TIMEOUT = 120_000;

/**
 * Get the last summary or update value from a run's entries.
 * Falls back to update if no summary exists (stall-complete).
 */
async function getLastStatus(db, runAlias) {
	const runRow = await db.get_run_by_alias.get({ alias: runAlias });
	const entries = await db.get_known_entries.all({ run_id: runRow.id });
	const summaries = entries.filter((e) => e.scheme === "summary");
	if (summaries.length > 0) return { type: "summary", value: summaries.at(-1).value };
	const updates = entries.filter((e) => e.scheme === "update");
	if (updates.length > 0) return { type: "update", value: updates.at(-1).value };
	return null;
}

describe("E2E Stories", () => {
	let tdb, tserver, client;
	const projectPath = join(tmpdir(), `rummy-stories-${Date.now()}`);

	before(async () => {
		await fs.mkdir(projectPath, { recursive: true });
		await fs.writeFile(
			join(projectPath, "config.json"),
			JSON.stringify({ port: 7777, host: "example.com", debug: false }),
		);
		await fs.writeFile(
			join(projectPath, "notes.txt"),
			"The secret word is: banana\n",
		);

		// File scanner requires git — bootstrap the project as a repo
		const { execSync } = await import("node:child_process");
		execSync(
			'git init && git config user.email "t@t" && git config user.name T && git add . && git commit --no-verify -m "init"',
			{ cwd: projectPath },
		);

		tdb = await TestDb.create();
		tserver = await TestServer.start(tdb.db);
		client = new AuditClient(tserver.url, tdb.db);
		await client.connect();
		await client.call("init", {
			projectPath,
			projectName: "StoriesTest",
			clientId: "c-stories",
		});
	});

	after(async () => {
		await client?.close();
		await tserver?.stop();
		await tdb?.cleanup();
		await fs.rm(projectPath, { recursive: true, force: true });
	});

	// Story: The model reads a file and answers about its content.
	// Verifies: file bootstrap, context assembly, summary content.
	it("answers a factual question from file content", {
		timeout: TIMEOUT,
	}, async () => {
		const result = await client.call("ask", {
			model,
			prompt: "What port number is in config.json? Reply ONLY with the number, nothing else.",
		});
		await client.assertRun(result, "completed", "factual answer");

		const status = await getLastStatus(tdb.db, result.run);
		assert.ok(status, "Run should have a summary or update");
		assert.ok(
			status.value.includes("7777"),
			`Response should contain 7777, got: "${status.value}"`,
		);
	});

	// Story: Two questions on the same run, model answers the SECOND one.
	// Verifies: prompt ordering, stale prompt not repeated, message structure.
	it("answers the second question, not the first", {
		timeout: TIMEOUT,
	}, async () => {
		const run1 = await client.call("ask", {
			model,
			prompt: "What is the secret word in notes.txt? Reply ONLY with the word.",
		});
		await client.assertRun(run1, "completed", "question 1");

		const run2 = await client.call("ask", {
			model,
			prompt: "What host is in config.json? Reply ONLY with the hostname.",
			run: run1.run,
		});
		await client.assertRun(run2, "completed", "question 2");
		assert.strictEqual(run2.run, run1.run, "Same run");

		const status = await getLastStatus(tdb.db, run2.run);
		assert.ok(status, "Turn 2 should have a response");

		// The critical assertion: model answered question 2, not question 1
		const val = status.value.toLowerCase();
		assert.ok(
			val.includes("example.com") || val.includes("example"),
			`Turn 2 should answer about the host, got: "${status.value}"`,
		);
	});

	// Story: Lite mode still delivers the prompt and gets an answer.
	// Verifies: engine doesn't skip prompt materialization in noContext.
	it("lite mode answers a simple question", {
		timeout: TIMEOUT,
	}, async () => {
		const result = await client.call("ask", {
			model,
			prompt: "What is 15 * 4? Reply ONLY with the number.",
			noContext: true,
		});
		await client.assertRun(result, "completed", "lite mode");

		const status = await getLastStatus(tdb.db, result.run);
		assert.ok(status, "Should have a response");
		assert.ok(
			status.value.includes("60"),
			`Response should contain 60, got: "${status.value}"`,
		);
	});

	// Story: Writing to a file path requires client approval.
	// Verifies: bare file writes go through proposed flow, not direct upsert.
	it("file write requires client approval", {
		timeout: TIMEOUT,
	}, async () => {
		const states = [];
		client.on("run/state", (p) => states.push(p));

		const result = await client.call("act", {
			model,
			prompt: 'Create a file called "output.txt" with the text "hello world". Use exactly: <write path="output.txt">hello world</write>',
		});

		await client.assertRun(
			result,
			["completed", "proposed"],
			"file write",
		);

		// Verify no bare file was written directly to store bypassing proposal
		const runRow = await tdb.db.get_run_by_alias.get({ alias: result.run });
		const entries = await tdb.db.get_known_entries.all({ run_id: runRow.id });
		const bareFile = entries.find(
			(e) => e.path === "output.txt" && e.state === "full",
		);
		assert.ok(
			!bareFile,
			"File should not be written directly to store without proposal",
		);
	});
});

import assert from "node:assert";
import fs from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import RpcClient from "../helpers/RpcClient.js";
import TestDb from "../helpers/TestDb.js";
import TestServer from "../helpers/TestServer.js";

describe("E2E Bedrock: Paris Steel Thread (LIVE)", () => {
	let tdb;
	let tserver;
	let client;
	const projectPath = join(process.cwd(), "test_bedrock_paris");

	before(async () => {
		if (!process.env.OPENROUTER_API_KEY) {
			throw new Error("OPENROUTER_API_KEY is required for live E2E tests");
		}
		await fs.mkdir(projectPath, { recursive: true }).catch(() => {});

		tdb = await TestDb.create("paris_bedrock");
		tserver = await TestServer.start(tdb.db);
		client = new RpcClient(tserver.url);
		await client.connect();
	});

	after(async () => {
		if (client) client.close();
		if (tserver) await tserver.stop();
		if (tdb) await tdb.cleanup();
		await fs.rm(projectPath, { recursive: true, force: true }).catch(() => {});
	});

	it("should complete the full Paris flow via LIVE OpenRouter", {
		timeout: 30000,
	}, async () => {
		// 1. Initialize
		await client.call("init", {
			projectPath,
			projectName: "Bedrock Test",
			clientId: "bedrock-1",
		});

		// 2. Ask using the system default model
		const model = process.env.SNORE_DEFAULT_MODEL;

		const askResult = await client.call("ask", {
			model,
			prompt: "What is the capital of France? Answer with exactly one word.",
		});

		// 3. Verify real response content
		assert.ok(
			askResult.response.toLowerCase().includes("paris"),
			`Expected Paris, got: ${askResult.response}`,
		);
		assert.ok(askResult.jobId);

		// 4. Verify Database Integrity
		const jobs = await tdb.db.get_job_by_id.all({ id: askResult.jobId });
		assert.strictEqual(jobs[0].status, "completed");

		const turns = await tdb.db.get_turns_by_job_id.all({
			job_id: askResult.jobId,
		});
		assert.strictEqual(turns.length, 2);

		// 5. Verify usage was recorded
		const usage = JSON.parse(turns[1].usage);
		assert.ok(usage.total_tokens > 0);
	});
});

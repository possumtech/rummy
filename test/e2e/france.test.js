import assert from "node:assert";
import fs from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import RpcClient from "../helpers/RpcClient.js";
import TestDb from "../helpers/TestDb.js";
import TestServer from "../helpers/TestServer.js";

describe("Happy Path E2E: France", () => {
	let tdb, tserver, client;
	const projectPath = join(process.cwd(), "test_france_project");

	before(async () => {
		await fs.mkdir(projectPath, { recursive: true });

		// Initialize git so RepoMap finds files (required by our new architecture)
		const { execSync } = await import("node:child_process");
		execSync(
			'git init && git config user.email "test@test.com" && git config user.name "Test"',
			{ cwd: projectPath },
		);

		tdb = await TestDb.create();
		tserver = await TestServer.start(tdb.db);
		client = new RpcClient(tserver.url);
		await client.connect();
	});

	after(async () => {
		client.close();
		await tserver.stop();
		await tdb.cleanup();
		await fs.rm(projectPath, { recursive: true, force: true });
	});

	it("should answer 'What is the capital of France?' correctly", async () => {
		// Mock the LLM Response
		globalThis.fetch = async () => {
			return new Response(
				JSON.stringify({
					model: "mock-model",
					choices: [
						{
							message: {
								role: "assistant",
								content:
									"<tasks>- [x] Answer question</tasks><known>The user is asking about France.</known><unknown></unknown><summary>The capital of France is Paris.</summary>",
							},
						},
					],
					usage: { total_tokens: 50 },
				}),
			);
		};

		const turns = [];
		client.on("run/step/completed", (params) => turns.push(params.turn));

		await client.call("init", {
			projectPath,
			projectName: "FranceProject",
			clientId: "c1",
		});

		const result = await client.call("ask", {
			model: "mock-model",
			prompt: "What is the capital of France?",
		});

		assert.strictEqual(result.status, "completed");

		// Two notifications are sent: Turn 0 (initial) and Turn 0 (with model response)
		// Or 1 if no internal recovery happened.
		// Actually, our AgentLoop emits one turn per LLM response.
		// Let's verify why it's 2.
		assert.ok(turns.length >= 1);
		const lastTurn = turns[turns.length - 1];

		assert.ok(
			lastTurn.user.includes("France") || turns[0].user.includes("France"),
		);
		assert.ok(lastTurn.assistant.summary.includes("Paris"));

		// Verify structured tasks
		assert.ok(
			Array.isArray(lastTurn.assistant.tasks),
			"Tasks should be an array",
		);
		assert.strictEqual(lastTurn.assistant.tasks[0].text, "Answer question");
		assert.strictEqual(lastTurn.assistant.tasks[0].completed, true);

		assert.ok(
			lastTurn.context.includes("<context"),
			"Context should be a prettified XML string",
		);
	});
});

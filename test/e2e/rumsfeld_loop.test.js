import assert from "node:assert";
import fs from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import RpcClient from "../helpers/RpcClient.js";
import TestDb from "../helpers/TestDb.js";
import TestServer from "../helpers/TestServer.js";

describe("Rumsfeld Loop E2E Verification", () => {
	let tserver;
	let client;
	let tdb;
	const projectPath = join(process.cwd(), "test_rumsfeld_e2e");

	before(async () => {
		process.env.RUMMY_DEBUG = "true";
		await fs.mkdir(projectPath, { recursive: true }).catch(() => {});
		await fs.writeFile(
			join(projectPath, "knowledge.txt"),
			"The secret key is ALBATROSS-1.",
		);

		tdb = await TestDb.create("rumsfeld_e2e");
		tserver = await TestServer.start(tdb.db);
		client = new RpcClient(tserver.url);
		await client.connect();
	});

	after(async () => {
		await client.close();
		await tserver.stop();
		await tdb.cleanup();
		await fs.rm(projectPath, { recursive: true, force: true }).catch(() => {});
	});

	it("should execute an autonomous <read> loop and maintain the Rumsfeld signature", async () => {
		const _session = await client.call("init", {
			projectPath,
			projectName: "Rumsfeld Test",
			clientId: "rumsfeld-1",
		});

		// 1. Mock first response: Model doesn't know content, asks to <read>
		// 2. Mock second response: Model has read content, provides <summary>
		let callCount = 0;
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => {
			callCount++;
			if (callCount === 1) {
				return new Response(
					JSON.stringify({
						model: "mock-model",
						choices: [
							{
								message: {
									role: "assistant",
									content:
										'<learned>I need to find the secret key.</learned><unknown>Content of knowledge.txt</unknown><tasks>- [ ] Read knowledge.txt</tasks><read file="knowledge.txt"/>',
								},
							},
						],
						usage: { total_tokens: 10 },
					}),
				);
			}
			return new Response(
				JSON.stringify({
					model: "mock-model",
					choices: [
						{
							message: {
								role: "assistant",
								content:
									"<learned>I have read the file.</learned><tasks>- [x] Read knowledge.txt</tasks><summary>The key is ALBATROSS-1</summary>",
							},
						},
					],
					usage: { total_tokens: 10 },
				}),
			);
		};

		try {
			// Track notifications
			const turns = [];
			client.on("run/step/completed", (params) => turns.push(params.turn));

			// Trigger the 'act' which should loop internally
			const result = await client.call("act", {
				model: "mock-model",
				prompt: "What is the secret key in knowledge.txt?",
			});

			// Verify the server looped twice internally
			assert.strictEqual(callCount, 2);
			assert.strictEqual(result.status, "completed");
			assert.strictEqual(result.turn, 1);

			// Verify the assistant content from the last turn notification
			assert.ok(turns[1].role.assistant.content.includes("ALBATROSS-1"));

			// Verify audits were written (sequential 0, 1)
			const runDir = join(process.cwd(), "audits", `run_${result.runId}`);
			// Use readdir to find the files as they are written at the end of each turn
			const files = await fs.readdir(runDir);
			assert.ok(files.includes("turn_0.xml"));
			assert.ok(files.includes("turn_1.xml"));

			const turn0 = await fs.readFile(join(runDir, "turn_0.xml"), "utf8");
			assert.ok(turn0.includes('&lt;read file="knowledge.txt"/&gt;'));
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("should block on <edit> and resolve declaratively via <info>", async () => {
		const _session = await client.call("init", {
			projectPath,
			projectName: "Rumsfeld Test",
			clientId: "rumsfeld-1",
		});

		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () =>
			new Response(
				JSON.stringify({
					model: "mock-model",
					choices: [
						{
							message: {
								role: "assistant",
								content:
									'<learned>Ready to edit.</learned><tasks>- [ ] Update key</tasks><edit file="knowledge.txt"><<<<<<< SEARCH\nALBATROSS-1\n=======\nALBATROSS-2\n>>>>>>> REPLACE</edit>',
							},
						},
					],
					usage: { total_tokens: 10 },
				}),
			);
try {
	// 1. First 'act' proposes the edit and BLOCKS
	const result = await client.call("act", {
		model: "mock-model",
		prompt: "Change key to ALBATROSS-2",
	});

	assert.strictEqual(result.status, "proposed");
	assert.strictEqual(result.turn, 0);

	const findings = await tdb.db.get_findings_by_run_id.all({ run_id: result.runId });
	assert.strictEqual(findings.length, 1);
	const diffId = findings[0].id;

	// 2. Sending another 'act' WITHOUT <info> should return the same blocked state immediately
	const blockedResult = await client.call("act", {
		model: "mock-model",
		prompt: "Do it now!",
		runId: result.runId,
	});
	assert.strictEqual(blockedResult.status, "proposed");

	// 3. Resolve via run/resolve
	globalThis.fetch = async () =>
		new Response(
			JSON.stringify({
				model: "mock-model",
				choices: [
					{
						message: {
							role: "assistant",
							content:
								"<learned>Done.</learned><tasks>- [x] Update key</tasks><short>Updated.</short>",
						},
					},
				],
				usage: { total_tokens: 10 },
			}),
		);

	const finalResult = await client.call("run/resolve", {
		runId: result.runId,
		resolution: { category: "diff", id: diffId, action: "accepted" }
	});

	assert.strictEqual(finalResult.runId, result.runId);
	assert.strictEqual(finalResult.turn, 1);


			// Verify file was actually written to disk
			const content = await fs.readFile(
				join(projectPath, "knowledge.txt"),
				"utf8",
			);
			assert.ok(content.includes("ALBATROSS-2"));
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

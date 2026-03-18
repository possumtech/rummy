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
			// Trigger the 'act' which should loop internally
			const result = await client.call("act", {
				model: "mock-model",
				prompt: "What is the secret key in knowledge.txt?",
			});

			// Verify the server looped twice internally
			assert.strictEqual(callCount, 2);
			assert.ok(result.content.includes("ALBATROSS-1"));

			// Verify audits were written
			const runDir = join(process.cwd(), "audits", `run_${result.runId}`);
			const turn0 = await fs.readFile(join(runDir, "turn_0.xml"), "utf8");
			const turn2 = await fs.readFile(join(runDir, "turn_2.xml"), "utf8");

			assert.ok(turn0.includes('<read file="knowledge.txt"/>'));
			assert.ok(turn2.includes("<summary>The key is ALBATROSS-1</summary>"));
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

			assert.strictEqual(result.diffs.length, 1);
			const diffId = result.diffs[0].id;

			// 2. Sending another 'act' WITHOUT <info> should return the same blocked state immediately (no LLM call)
			const blockedResult = await client.call("act", {
				model: "mock-model",
				prompt: "Do it now!",
				runId: result.runId,
			});
			assert.ok(blockedResult.content.includes("Blocked"));
			assert.strictEqual(blockedResult.diffs[0].id, diffId);

			// 3. Resolve via <info>
			globalThis.fetch = async () =>
				new Response(
					JSON.stringify({
						model: "mock-model",
						choices: [
							{
								message: {
									role: "assistant",
									content:
										"<learned>Done.</learned><tasks>- [x] Update key</tasks><summary>Updated.</summary>",
								},
							},
						],
						usage: { total_tokens: 10 },
					}),
				);

			const finalResult = await client.call("act", {
				model: "mock-model",
				prompt: `<info diff="${diffId}">Accepted</info>`,
				runId: result.runId,
			});

			assert.ok(finalResult.content.includes("Updated"));

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

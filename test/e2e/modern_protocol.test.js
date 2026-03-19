import assert from "node:assert";
import fs from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import RpcClient from "../helpers/RpcClient.js";
import TestDb from "../helpers/TestDb.js";
import TestServer from "../helpers/TestServer.js";

describe("Modern Protocol E2E", () => {
	let tdb, tserver, client;
	const projectPath = join(process.cwd(), "test_modern_e2e");

	before(async () => {
		await fs.mkdir(projectPath, { recursive: true });
		await fs.writeFile(
			join(projectPath, "secret.txt"),
			"The password is BLUE-BIRD",
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

	it("1. Protocol Sanity: should receive structured JSON turn data", async () => {
		globalThis.fetch = async () =>
			new Response(
				JSON.stringify({
					model: "mock-model",
					choices: [
						{
							message: {
								role: "assistant",
								content: "<response>Hello</response><short>Hi</short>",
							},
						},
					],
					usage: { total_tokens: 10 },
				}),
			);

		const turns = [];
		client.on("run/step/completed", (params) => turns.push(params.turn));

		const _res = await client.call("init", {
			projectPath,
			projectName: "Sanity",
			clientId: "c1",
		});
		const result = await client.call("ask", {
			model: "mock-model",
			prompt: "Ping",
		});

		assert.strictEqual(result.status, "completed");
		assert.strictEqual(result.turn, 0);
		assert.strictEqual(turns.length, 1);

		const turn = turns[0];
		assert.strictEqual(turn.sequence, 0);
		assert.ok(turn.system.includes("ASK mode"));
		assert.strictEqual(turn.user, "Ping");
		assert.ok(turn.assistant.content.includes("<response>Hello</response>"));
	});

	it("2. Multi-turn Loop: should complete an autonomous read-then-summary sequence", async () => {
		let callCount = 0;
		globalThis.fetch = async () => {
			callCount++;
			const content =
				callCount === 1
					? '<unknown>secret.txt</unknown><tasks>- [ ] Read secret</tasks><read file="secret.txt"/>'
					: "<tasks>- [x] Read secret</tasks><response>It is BLUE-BIRD</response><short>BLUE-BIRD</short>";

			return new Response(
				JSON.stringify({
					model: "mock-model",
					choices: [{ message: { role: "assistant", content } }],
					usage: { total_tokens: 10 },
				}),
			);
		};

		const turns = [];
		client.removeAllListeners("run/step/completed");
		client.on("run/step/completed", (params) => turns.push(params.turn));

		const result = await client.call("act", {
			model: "mock-model",
			prompt: "Get the secret",
		});

		assert.strictEqual(result.status, "completed");
		assert.strictEqual(result.turn, 1); // 0 (read) then 1 (response)
		assert.strictEqual(turns.length, 2);

		assert.strictEqual(turns[0].sequence, 0);
		assert.strictEqual(turns[1].sequence, 1);
		assert.ok(turns[1].assistant.content.includes("BLUE-BIRD"));
	});

	it("3. Human-in-the-Loop: should pause for prompt_user and resume via run/resolve", async () => {
		globalThis.fetch = async () =>
			new Response(
				JSON.stringify({
					model: "mock-model",
					choices: [
						{
							message: {
								role: "assistant",
								content:
									"<prompt_user>Color? - [ ] Red - [ ] Blue</prompt_user>",
							},
						},
					],
					usage: { total_tokens: 10 },
				}),
			);

		const result = await client.call("ask", {
			model: "mock-model",
			prompt: "What color?",
		});

		assert.strictEqual(result.status, "proposed");

		// Find the notification in the DB
		const findings = await tdb.db.get_findings_by_run_id.all({
			run_id: result.runId,
		});
		const prompt = findings.find((f) => f.type === "prompt_user");
		assert.ok(prompt);

		const config = JSON.parse(prompt.config);
		assert.strictEqual(config.options[0].label, "Red");
		assert.strictEqual(config.options[2].label, "Other"); // Auto-appended

		// Resume via run/resolve
		globalThis.fetch = async () =>
			new Response(
				JSON.stringify({
					model: "mock-model",
					choices: [
						{
							message: {
								role: "assistant",
								content:
									"<response>User chose Red</response><short>Red</short>",
							},
						},
					],
					usage: { total_tokens: 10 },
				}),
			);

		const resolved = await client.call("run/resolve", {
			runId: result.runId,
			resolution: { category: "notification", id: prompt.id, answer: "Red" },
		});

		assert.strictEqual(resolved.status, "completed");
		assert.strictEqual(resolved.turn, 1);
	});
});

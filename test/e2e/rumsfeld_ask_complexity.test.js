import assert from "node:assert";
import fs from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import RpcClient from "../helpers/RpcClient.js";
import TestDb from "../helpers/TestDb.js";
import TestServer from "../helpers/TestServer.js";

/**
 * This test verifies the Rumsfeld Loop in ASK mode.
 * It tasks the model with identifying complexity, which requires repository exploration.
 */
describe("Rumsfeld Loop ASK: Complexity Analysis", () => {
	let tserver;
	let client;
	let tdb;
	const projectPath = process.cwd(); // Analysis of this actual repo
	const model = process.env.RUMMY_MODEL_DEFAULT;

	before(async () => {
		process.env.RUMMY_DEBUG = "true";
		if (!process.env.OPENROUTER_API_KEY) {
			console.warn("Skipping live test: OPENROUTER_API_KEY not set.");
			return;
		}

		tdb = await TestDb.create("rumsfeld_ask");
		tserver = await TestServer.start(tdb.db);
		client = new RpcClient(tserver.url);
		await client.connect();
	});

	after(async () => {
		if (client) await client.close();
		if (tserver) await tserver.stop();
		if (tdb) await tdb.cleanup();
	});

	it("should autonomously explore the repo and identify the most complex file", async function () {
		if (!process.env.OPENROUTER_API_KEY) this.skip();

		// Exploration can take several turns
		this.timeout = 180000;

		await client.call("init", {
			projectPath,
			projectName: "Snore Core Analysis",
			clientId: "complexity-tester",
		});

		const result = await client.call(
			"ask",
			{
				model,
				prompt:
					"Analyze this repository and tell me which file is the most complex, and why. Use any tools necessary to gather evidence.",
			},
			undefined,
			150000,
		);

		console.log("Live Model Complexity Analysis:", result.content);

		// Assertions:
		// 1. It should have completed the tasks
		assert.ok(result.analysis, "Response missing analysis field");
		assert.ok(
			result.content.includes("<analysis>"),
			"Response missing <analysis> tag",
		);
		assert.ok(
			result.content.includes("<summary>"),
			"Response missing <summary> tag",
		);

		// 2. It should have identified a complex candidate
		assert.match(
			result.content,
			/(ProjectAgent|AgentLoop|RepoMap|initial_schema)\.(js|sql)/i,
			"Model failed to identify a complex candidate.",
		);

		// 3. Verify Rumsfeld Loop occurred via audits (at least turn 0 and turn 2)
		const runDir = join(process.cwd(), "audits", `run_${result.runId}`);
		const turn0 = await fs
			.access(join(runDir, "turn_0.xml"))
			.then(() => true)
			.catch(() => false);
		const turn2 = await fs
			.access(join(runDir, "turn_2.xml"))
			.then(() => true)
			.catch(() => false);

		assert.ok(turn0, "Audit turn_0.xml missing");
		assert.ok(
			turn2,
			"Audit turn_2.xml missing - Model likely didn't loop/gather.",
		);
	});
});

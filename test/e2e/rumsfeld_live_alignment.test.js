import assert from "node:assert";
import fs from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import RpcClient from "../helpers/RpcClient.js";
import TestDb from "../helpers/TestDb.js";
import TestServer from "../helpers/TestServer.js";

/**
 * This test uses a LIVE model to verify the Rumsfeld Loop and system instructions.
 * It requires OPENROUTER_API_KEY to be set.
 */
describe("Rumsfeld Loop Live Real-World Alignment", () => {
	let tserver;
	let client;
	let tdb;
	let projectPath;
	const model = process.env.RUMMY_MODEL_DEFAULT;

	before(async () => {
		process.env.RUMMY_DEBUG = "true";
		if (!process.env.OPENROUTER_API_KEY) {
			console.warn("Skipping live test: OPENROUTER_API_KEY not set.");
			return;
		}
		projectPath = join(process.cwd(), `test_rumsfeld_live_${Date.now()}`);
		await fs.mkdir(projectPath, { recursive: true }).catch(() => {});
		// Content: "MODE: ALPHA" -> Should result in "Primary"
		await fs.writeFile(join(projectPath, "protocol.txt"), "MODE: ALPHA");

		tdb = await TestDb.create("rumsfeld_live");
		tserver = await TestServer.start(tdb.db);
		client = new RpcClient(tserver.url);
		await client.connect();
	});

	after(async () => {
		if (client) await client.close();
		if (tserver) await tserver.stop();
		if (tdb) await tdb.cleanup();
		await fs.rm(projectPath, { recursive: true, force: true }).catch(() => {});
	});

	it("should autonomously read protocol.txt and create result.txt with 'Primary' based on content", async function () {
		if (!process.env.OPENROUTER_API_KEY) this.skip();

		this.timeout = 60000;

		await client.call("init", {
			projectPath,
			projectName: "Live Rumsfeld Test",
			clientId: "live-tester",
		});

		let result = await client.call("act", {
			model,
			prompt:
				"Check protocol.txt. If it is in ALPHA mode, create result.txt with 'Primary'. If it is in BETA status, create result.txt with 'Secondary'.",
		});

		// Resolve any proposed changes
		if (result.diffs && result.diffs.length > 0) {
			const diffId = result.diffs[0].id;
			result = await client.call("act", {
				model,
				prompt: `<info diff="${diffId}">Accepted</info>`,
				runId: result.runId,
			});
		}

		console.log("Live Model Final Content:", result.content);

		const targetPath = join(projectPath, "result.txt");
		const exists = await fs
			.access(targetPath)
			.then(() => true)
			.catch(() => false);
		assert.ok(exists, "result.txt was not created");

		const content = (await fs.readFile(targetPath, "utf8")).trim();
		assert.strictEqual(
			content,
			"Primary",
			`Expected 'Primary', got '${content}'`,
		);

		assert.ok(result.analysis, "Response missing analysis field");
		assert.ok(
			result.content.includes("<analysis>"),
			"Response missing <analysis> tag",
		);
		assert.ok(
			result.content.includes("<summary>"),
			"Response missing <summary> tag",
		);
	});
});

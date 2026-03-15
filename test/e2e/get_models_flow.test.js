import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import RpcClient from "../helpers/RpcClient.js";
import TestDb from "../helpers/TestDb.js";
import TestServer from "../helpers/TestServer.js";

describe("E2E Bedrock: getOpenRouterModels (LIVE)", () => {
	let tdb;
	let tserver;
	let client;

	before(async () => {
		if (!process.env.OPENROUTER_API_KEY) {
			throw new Error("OPENROUTER_API_KEY is required");
		}
		tdb = await TestDb.create("get_models_e2e");
		tserver = await TestServer.start(tdb.db);
		client = new RpcClient(tserver.url);
		await client.connect();
	});

	after(async () => {
		if (client) client.close();
		if (tserver) await tserver.stop();
		if (tdb) await tdb.cleanup();
	});

	it("should fetch real models from OpenRouter via RPC", {
		timeout: 30000,
	}, async () => {
		const models = await client.call("getOpenRouterModels");
		assert.ok(Array.isArray(models));
		assert.ok(models.length > 0);
		assert.ok(models.some((m) => m.id.includes("deepseek")));
	});
});

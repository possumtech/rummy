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
			throw new Error("OPENROUTER_API_KEY is required for live E2E tests");
		}
		tdb = await TestDb.create("live_models");
		tserver = await TestServer.start(tdb.db);
		client = new RpcClient(tserver.url);
		await client.connect();
	});

	after(async () => {
		client.close();
		await tserver.stop();
		await tdb.cleanup();
	});

	it("should fetch real models from OpenRouter via RPC", async () => {
		const models = await client.call("getOpenRouterModels");
		assert.ok(Array.isArray(models), "Should return an array of models");
		assert.ok(models.length > 100, "Should see a large list of live models");
		assert.ok(
			models.some((m) => m.id.includes("gpt-4o")),
			"Should include gpt-4o in live list",
		);
	});
});

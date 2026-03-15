import assert from "node:assert";
import fs from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import RpcClient from "../helpers/RpcClient.js";
import TestDb from "../helpers/TestDb.js";
import TestServer from "../helpers/TestServer.js";

const originalFetch = globalThis.fetch;

describe("SOCKET_PROTOCOL v0.2.0 Verification", () => {
	let tdb;
	let tserver;
	let client;
	const projectPath = join(process.cwd(), "test_protocol_v020");

	before(async () => {
		globalThis.fetch = async () => {
			return new Response(JSON.stringify({
				choices: [{ message: { role: "assistant", content: "Original Response" } }],
				usage: { total_tokens: 10 }
			}), { 
				status: 200, 
				headers: { "Content-Type": "application/json" } 
			});
		};

		await fs.mkdir(projectPath, { recursive: true }).catch(() => {});
		tdb = await TestDb.create("protocol_v020");
		tserver = await TestServer.start(tdb.db);
		client = new RpcClient(tserver.url);
		await client.connect();
	});

	after(async () => {
		globalThis.fetch = originalFetch;
		if (client) client.close();
		if (tserver) await tserver.stop();
		if (tdb) await tdb.cleanup();
		await fs.rm(projectPath, { recursive: true, force: true }).catch(() => {});
	});

	it("should support 'ping' method", async () => {
		const result = await client.call("ping", {});
		assert.deepStrictEqual(result, {});
	});

	it("should support 'act' method and notifications", async () => {
		await client.call("init", {
			projectPath,
			projectName: "Protocol Test",
			clientId: "test-client",
		});

		// Mock LLM response to trigger notifications via SnoreNvimPlugin
		tserver.hooks.addFilter("llm.response", (response) => {
			return {
				...response,
				content: "Acting on files... SNORE_TEST_NOTIFY SNORE_TEST_DIFF",
			};
		});

		const actPromise = client.call("act", {
			model: "mock-model",
			prompt: "Trigger notifications",
		});

		// Wait for notifications
		const notify = await client.waitForNotification(
			(n) => n.method === "ui/notify",
		);
		assert.strictEqual(notify.params.text, "Test notification from SnoreNvimPlugin");

		const diff = await client.waitForNotification(
			(n) => n.method === "editor/diff",
		);
		assert.strictEqual(diff.params.file, "test.txt");
		assert.ok(diff.params.patch.includes("--- test.txt"));

		const result = await actPromise;
		assert.ok(result.jobId);
		assert.ok(result.response.includes("Acting on files"));
	});
});

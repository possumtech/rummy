import assert from "node:assert";
import fs from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import RpcClient from "../helpers/RpcClient.js";
import TestDb from "../helpers/TestDb.js";
import TestServer from "../helpers/TestServer.js";

const originalFetch = globalThis.fetch;

describe("SOCKET_PROTOCOL v0.2.0 Verification (Full Compliance)", () => {
	let tdb;
	let tserver;
	let client;
	const projectPath = join(process.cwd(), "test_protocol_v020");

	before(async () => {
		globalThis.fetch = async () => {
			return new Response(JSON.stringify({
				choices: [{ message: { role: "assistant", content: "Original Response", reasoning_content: "Thought process" } }],
				usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 }
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

	it("should support 'getModels' method", async () => {
		const result = await client.call("getModels", {});
		assert.ok(Array.isArray(result));
	});

	it("should support lifecycle and file operations", async () => {
		const initResult = await client.call("init", {
			projectPath,
			projectName: "Protocol Test",
			clientId: "test-client",
		});
		assert.ok(initResult.context);
		assert.ok("gitRoot" in initResult.context);

		// updateFiles
		const updateResult = await client.call("updateFiles", {
			files: [
				{ path: "README.md", visibility: "active" }
			]
		});
		assert.strictEqual(updateResult.status, "ok");

		// getFiles
		const files = await client.call("getFiles", {});
		assert.ok(Array.isArray(files));
		assert.ok(files.some(f => f.path === "README.md"));
	});

	it("should support 'act' method and all notifications", async () => {
		// Mock LLM response to trigger all notifications via SnoreNvimPlugin
		tserver.hooks.addFilter("llm.response", (response) => {
			return {
				...response,
				content: "Acting... SNORE_TEST_NOTIFY SNORE_TEST_RENDER SNORE_TEST_DIFF",
				reasoning_content: "I need to notify and diff."
			};
		});

		const actPromise = client.call("act", {
			model: "mock-model",
			prompt: "Trigger notifications",
		});

		// ui/notify
		const notify = await client.waitForNotification(
			(n) => n.method === "ui/notify",
			15000
		);
		assert.strictEqual(notify.params.text, "Test notification from SnoreNvimPlugin");

		// ui/render
		const render = await client.waitForNotification(
			(n) => n.method === "ui/render",
			15000
		);
		assert.strictEqual(render.params.text, "# Render Test");
		assert.strictEqual(render.params.append, false);

		// editor/diff
		const diff = await client.waitForNotification(
			(n) => n.method === "editor/diff",
			15000
		);
		assert.strictEqual(diff.params.file, "test.txt");
		assert.ok(diff.params.patch.includes("--- test.txt"));

		const result = await actPromise;
		assert.ok(result.id);
		const message = result.choices[0].message;
		assert.strictEqual(message.role, "assistant");
		assert.ok(message.content.includes("Acting..."));
		assert.strictEqual(message.reasoning_content, "I need to notify and diff.");
		assert.ok(result.usage);
		assert.strictEqual(result.usage.total_tokens, 10);
	});
});

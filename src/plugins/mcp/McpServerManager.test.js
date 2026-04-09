import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import McpServerManager from "./McpServerManager.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_SERVER_PATH = join(
	__dirname,
	"../../../test/helpers/McpMockServer.js",
);

describe("McpServerManager", () => {
	const manager = new McpServerManager();

	after(() => {
		manager.stopAll();
	});

	it("spawns a server and performs handshake", async () => {
		const server = await manager.spawn("mock", "node", [MOCK_SERVER_PATH]);
		assert.ok(server.child, "server should have a child process");
		assert.ok(server.call, "server should have a call method");
	});

	it("lists tools from the server", async () => {
		const tools = await manager.listTools("mock");
		assert.ok(Array.isArray(tools), "tools should be an array");
		assert.equal(tools[0].name, "echo");
	});

	it("calls a tool and returns the result", async () => {
		const result = await manager.callTool("mock", "echo", { message: "hello" });
		assert.ok(result.content, "result should have content");
		assert.equal(result.content[0].text, "Echo: hello");
	});

	it("reuses existing server instance", async () => {
		const server1 = await manager.spawn("mock", "node", [MOCK_SERVER_PATH]);
		const server2 = await manager.spawn("mock", "node", [MOCK_SERVER_PATH]);
		assert.strictEqual(
			server1,
			server2,
			"should return same instance for same name",
		);
	});

	it("stops a server", async () => {
		manager.stop("mock");
		await assert.rejects(
			async () => {
				await manager.listTools("mock");
			},
			{
				message: "Server mock not running",
			},
		);
	});
});

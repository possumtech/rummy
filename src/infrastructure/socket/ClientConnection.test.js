import test from "node:test";
import assert from "node:assert";
import ClientConnection from "./ClientConnection.js";
import createHooks from "../../domain/hooks/Hooks.js";

test("ClientConnection", async (t) => {
	const mockDb = {
		upsert_project: { run: async () => {} },
		get_project_by_path: { all: async () => [{ id: "p1" }] },
		create_session: { run: async () => {} },
		get_project_by_id: { get: async () => ({ path: "/tmp" }) },
		get_session_by_id: { all: async () => [{ project_id: "p1" }] },
		get_session_skills: { all: async () => [] },
		get_models: { all: async () => [] },
		get_run_by_id: { get: async () => null },
		get_project_repo_map: { all: async () => [] },
		create_run: { run: async () => {} },
		update_run_status: { run: async () => {} },
		create_turn: { get: async () => ({ id: 1 }) }
	};

	await t.test("handleMessage should process ping", async () => {
		let sent = null;
		const ws = { on: () => {}, send: (d) => { sent = JSON.parse(d); }, readyState: 1 };
		const conn = new ClientConnection(ws, mockDb, createHooks());
		await conn.handleMessageForTest(Buffer.from(JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 })));
		assert.strictEqual(sent.id, 1);
	});

	await t.test("handleMessage should process init and session state", async () => {
		let sent = null;
		const ws = { on: () => {}, send: (d) => { sent = JSON.parse(d); }, readyState: 1 };
		const conn = new ClientConnection(ws, mockDb, createHooks());
		
		await conn.handleMessageForTest(Buffer.from(JSON.stringify({ 
			jsonrpc: "2.0", method: "init", params: { projectPath: "/tmp", projectName: "P", clientId: "c1" }, id: 2 
		})));
		assert.ok(sent.result.sessionId);

		await conn.handleMessageForTest(Buffer.from(JSON.stringify({ jsonrpc: "2.0", method: "getFiles", id: 3 })));
		assert.ok(Array.isArray(sent.result));
	});

	await t.test("handleMessage should process ask", async () => {
		let sent = null;
		const ws = { on: () => {}, send: (d) => { sent = JSON.parse(d); }, readyState: 1 };
		const conn = new ClientConnection(ws, mockDb, createHooks());
		
		await conn.handleMessageForTest(Buffer.from(JSON.stringify({ 
			jsonrpc: "2.0", method: "init", params: { projectPath: "/tmp", projectName: "P", clientId: "c1" }, id: 4 
		})));

		globalThis.fetch = async () => new Response(JSON.stringify({
			choices: [{ message: { role: "assistant", content: "<tasks>- [x] ok</tasks><response>Hi</response>" } }],
			usage: { total_tokens: 5 }
		}));

		await conn.handleMessageForTest(Buffer.from(JSON.stringify({ jsonrpc: "2.0", method: "ask", params: { prompt: "hi" }, id: 5 })));
		assert.strictEqual(sent.result.status, "completed");
	});

	await t.test("should handle invalid method", async () => {
		let sent = null;
		const ws = { on: () => {}, send: (d) => { sent = JSON.parse(d); }, readyState: 1 };
		const conn = new ClientConnection(ws, mockDb, createHooks());
		await conn.handleMessageForTest(Buffer.from(JSON.stringify({ jsonrpc: "2.0", method: "invalid", id: 6 })));
		assert.ok(sent.error);
	});

	await t.test("run/resolve should handle missing run", async () => {
		let sent = null;
		const ws = { on: () => {}, send: (d) => { sent = JSON.parse(d); }, readyState: 1 };
		const conn = new ClientConnection(ws, mockDb, createHooks());
		await conn.handleMessageForTest(Buffer.from(JSON.stringify({ 
			jsonrpc: "2.0", method: "run/resolve", params: { runId: "none", resolution: {} }, id: 7 
		})));
		assert.ok(sent.error);
	});
});

import assert from "node:assert";
import { describe, it, mock } from "node:test";
import ClientConnection from "./ClientConnection.js";

describe("ClientConnection", () => {
	const createMocks = () => {
		const ws = { on: mock.fn(), send: mock.fn(), readyState: 1 };
		const db = {
			upsert_project: { run: mock.fn() },
			get_project_by_path: { all: mock.fn(async () => [{ id: "p1" }]) },
			get_project_by_id: {
				get: mock.fn(async () => ({ id: "p1", path: process.cwd() })),
			},
			get_session_by_id: { all: mock.fn(async () => [{ project_id: "p1" }]) },
			create_session: { run: mock.fn() },
			get_repo_map_file: { get: mock.fn(async () => null) },
			upsert_repo_map_file: { get: mock.fn(async () => ({ id: "f1" })) },
			clear_repo_map_file_data: { run: mock.fn() },
			insert_repo_map_tag: { run: mock.fn() },
			insert_repo_map_ref: { run: mock.fn() },
			get_project_repo_map: { all: mock.fn(async () => []) },
			get_models: { all: mock.fn(async () => []) },
			get_file_references: { all: mock.fn(async () => []) },
			create_job: { run: mock.fn() },
			create_turn: { run: mock.fn() },
			update_job_status: { run: mock.fn() },
		};
		return { ws, db };
	};

	const runMethod = async (conn, ws, method, params = {}, id = "req") => {
		const message = JSON.stringify({ jsonrpc: "2.0", method, params, id });
		await conn.handleMessageForTest(message);
		return JSON.parse(
			ws.send.mock.calls[ws.send.mock.calls.length - 1].arguments[0],
		);
	};

	it("should handle 'init' method", async () => {
		const { ws, db } = createMocks();
		const conn = new ClientConnection(ws, db);
		const response = await runMethod(conn, ws, "init", {
			projectPath: process.cwd(),
		});
		assert.strictEqual(response.result.projectId, "p1");
	});

	it("should handle 'getFiles' method", async () => {
		const { ws, db } = createMocks();
		const conn = new ClientConnection(ws, db);
		await runMethod(conn, ws, "init", { projectPath: process.cwd() });
		const response = await runMethod(conn, ws, "getFiles");
		assert.ok(Array.isArray(response.result));
	});

	it("should handle 'getOpenRouterModels' method", async () => {
		const { ws, db } = createMocks();
		process.env.OPENROUTER_API_KEY = "test";
		mock.method(globalThis, "fetch", async () => ({
			ok: true,
			json: async () => ({ data: [] }),
		}));
		const conn = new ClientConnection(ws, db);
		const response = await runMethod(conn, ws, "getOpenRouterModels");
		assert.ok(Array.isArray(response.result));
	});

	it("should handle 'ask' method", async () => {
		const { ws, db } = createMocks();
		mock.method(globalThis, "fetch", async () => ({
			ok: true,
			json: async () => ({
				choices: [{ message: { content: "Paris" } }],
				usage: {},
			}),
		}));
		const conn = new ClientConnection(ws, db);
		await runMethod(conn, ws, "init", { projectPath: process.cwd() });
		const response = await runMethod(conn, ws, "ask", {
			model: "gpt-4o",
			prompt: "Capital?",
		});
		assert.strictEqual(response.result.response, "Paris");
	});

	it("should handle 'startJob' method", async () => {
		const { ws, db } = createMocks();
		const conn = new ClientConnection(ws, db);
		await runMethod(conn, ws, "init", { projectPath: process.cwd() });
		const response = await runMethod(conn, ws, "startJob", {
			type: "orchestrator",
		});
		assert.ok(response.result);
	});

	it("should return error if not initialized for getFiles", async () => {
		const { ws, db } = createMocks();
		const conn = new ClientConnection(ws, db);
		const response = await runMethod(conn, ws, "getFiles");
		assert.ok(response.error.message.includes("Project not initialized"));
	});

	it("should return error if not initialized for ask", async () => {
		const { ws, db } = createMocks();
		const conn = new ClientConnection(ws, db);
		const response = await runMethod(conn, ws, "ask", {
			model: "m",
			prompt: "p",
		});
		assert.ok(response.error.message.includes("Session not initialized"));
	});

	it("should return error if not initialized for startJob", async () => {
		const { ws, db } = createMocks();
		const conn = new ClientConnection(ws, db);
		const response = await runMethod(conn, ws, "startJob");
		assert.ok(response.error.message.includes("Session not initialized"));
	});

	it("should return error for unknown method", async () => {
		const { ws, db } = createMocks();
		const conn = new ClientConnection(ws, db);
		const response = await runMethod(conn, ws, "unknown");
		assert.ok(response.error);
	});
});

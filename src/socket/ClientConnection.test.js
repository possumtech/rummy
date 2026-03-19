import assert from "node:assert";
import { after, before, describe, it, mock } from "node:test";
import TestDb from "../../test/helpers/TestDb.js";
import createHooks from "../core/Hooks.js";
import { registerPlugins } from "../plugins/index.js";
import ClientConnection from "./ClientConnection.js";

describe("ClientConnection", () => {
	let hooks;
	let tdb;

	before(async () => {
		process.env.OPENROUTER_API_KEY = "test-key";
		process.env.OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
		process.env.RUMMY_MODEL_DEFAULT = "test-model";
		process.env.RUMMY_HTTP_REFERER = "http://test";
		process.env.RUMMY_X_TITLE = "Test";
		hooks = createHooks();
		await registerPlugins([], hooks);
		tdb = await TestDb.create("client_connection");
	});

	after(async () => {
		if (tdb) await tdb.cleanup();
	});

	const createMocks = () => {
		const ws = { on: mock.fn(), send: mock.fn(), readyState: 1 };
		return { ws, db: tdb.db };
	};

	const runMethod = async (conn, ws, method, params = {}, id = "req") => {
		const message = JSON.stringify({ jsonrpc: "2.0", method, params, id });
		await conn.handleMessageForTest(message);
		const lastCall = ws.send.mock.calls[ws.send.mock.calls.length - 1];
		return {
			result: JSON.parse(lastCall.arguments[0]),
			allSent: ws.send.mock.calls.map((c) => JSON.parse(c.arguments[0])),
		};
	};

	it("should handle 'init' method", async () => {
		const { ws, db } = createMocks();
		const conn = new ClientConnection(ws, db, hooks);
		const { result: response } = await runMethod(conn, ws, "init", {
			projectPath: process.cwd(),
			projectName: "Test Project",
			clientId: "test-client",
		});
		assert.ok(response.result.projectId);
		assert.ok(response.result.sessionId);
	});

	it("should handle 'ask' method", async () => {
		const { ws, db } = createMocks();
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () =>
			new Response(
				JSON.stringify({
					model: "test-model",
					choices: [
						{
							message: {
								role: "assistant",
								content: "<response>Paris</response><short>Paris</short>",
							},
						},
					],
					usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);

		try {
			const conn = new ClientConnection(ws, db, hooks);
			await runMethod(conn, ws, "init", {
				projectPath: process.cwd(),
				projectName: "T",
				clientId: "c",
			});
			const { result: response, allSent } = await runMethod(conn, ws, "ask", {
				model: "test-model",
				prompt: "p",
			});

			assert.ok(response.result.runId);
			assert.strictEqual(response.result.status, "completed");
			assert.strictEqual(response.result.turn, 0);

			const turnNotif = allSent.find((m) => m.method === "run/step/completed");
			assert.ok(turnNotif);
			assert.ok(turnNotif.params.turn.assistant.content.includes("Paris"));
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

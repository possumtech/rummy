import assert from "node:assert";
import test from "node:test";
import TestDb from "../../../test/helpers/TestDb.js";
import createHooks from "../../domain/hooks/Hooks.js";
import ClientConnection from "./ClientConnection.js";

test("ClientConnection (Real Integration)", async (t) => {
	let tdb;
	const model = "hyzenqwen";

	t.before(async () => {
		tdb = await TestDb.create();
	});

	t.after(async () => {
		await tdb.cleanup();
	});

	const createRealConn = () => {
		const state = { sent: [] };
		const ws = {
			on: () => {},
			send: (d) => {
				state.sent.push(JSON.parse(d));
			},
			readyState: 1,
		};
		const conn = new ClientConnection(ws, tdb.db, createHooks());
		return { conn, state };
	};

	await t.test("should handle basic lifecycle using real DB", async () => {
		const { conn, state } = createRealConn();

		await conn.handleMessageForTest(
			Buffer.from(JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 })),
		);
		assert.deepStrictEqual(state.sent[0].result, {});

		await conn.handleMessageForTest(
			Buffer.from(
				JSON.stringify({
					jsonrpc: "2.0",
					method: "init",
					id: 2,
					params: {
						projectPath: "/tmp/conn-test",
						projectName: "ConnTest",
						clientId: "c1",
					},
				}),
			),
		);
		assert.ok(state.sent[1].result.projectId);
	});

	await t.test("should handle ask/act using real hyzenqwen", async () => {
		const { conn, state } = createRealConn();
		// Init first
		await conn.handleMessageForTest(
			Buffer.from(
				JSON.stringify({
					jsonrpc: "2.0",
					method: "init",
					id: 1,
					params: {
						projectPath: "/tmp/conn-ask",
						projectName: "AskTest",
						clientId: "c2",
					},
				}),
			),
		);

		await conn.handleMessageForTest(
			Buffer.from(
				JSON.stringify({
					jsonrpc: "2.0",
					method: "ask",
					id: 2,
					params: { model, prompt: "Say 'Ready'." },
				}),
			),
		);

		// Wait for the result matching ID 2 to appear in the sent array
		const start = Date.now();
		let resultMsg = null;
		while (Date.now() - start < 30000) {
			resultMsg = state.sent.find((m) => m.id === 2);
			if (resultMsg) break;
			await new Promise((r) => setTimeout(r, 100));
		}

		assert.ok(resultMsg, "RPC response for 'ask' never arrived");
		assert.ok(resultMsg.result.status, "Response missing status field");
	});
});

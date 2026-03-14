import assert from "node:assert";
import { afterEach, describe, it } from "node:test";
import SocketServer from "./SocketServer.js";

describe("SocketServer", { concurrency: 1 }, () => {
	let server;

	afterEach(async () => {
		if (server) {
			await server.close();
			server = null;
			await new Promise((r) => setTimeout(r, 50));
		}
	});

	it("should start and stop a websocket server on an available port", async () => {
		const mockDb = {};
		server = new SocketServer(mockDb, { port: 0 });
		const addr = server.address();
		assert.ok(addr.port > 0);
	});

	it("should handle address in use error asynchronously", async () => {
		const mockDb = {};
		const s1 = new SocketServer(mockDb, { port: 0 });
		const port = s1.address().port;

		const s2 = new SocketServer(mockDb, { port });

		const errorPromise = new Promise((resolve) => {
			s2.on("error", (err) => {
				assert.strictEqual(err.code, "EADDRINUSE");
				resolve();
			});
		});

		await errorPromise;
		await s1.close();
		await s2.close();
	});

	it("should handle close cleanly", async () => {
		const mockDb = {};
		const s = new SocketServer(mockDb, { port: 0 });
		await s.close();
		assert.ok(true);
	});
});

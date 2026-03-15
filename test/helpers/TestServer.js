import { fileURLToPath } from "node:url";
import createHooks from "../../src/core/Hooks.js";
import { registerPlugins } from "../../src/plugins/index.js";
import SocketServer from "../../src/socket/SocketServer.js";

export default class TestServer {
	static async start(db) {
		const hooks = createHooks();
		const internalDir = fileURLToPath(
			new URL("../../src/internal", import.meta.url),
		);
		await registerPlugins([internalDir], hooks);

		const server = new SocketServer(db, { port: 0, hooks });
		const address = server.address();
		const url = `ws://localhost:${address.port}`;

		return { server, url, stop: () => server.close() };
	}
}

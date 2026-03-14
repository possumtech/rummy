import SocketServer from "../../src/socket/SocketServer.js";

export default class TestServer {
	static async start(db) {
		const port = process.env.PORT || 3000;
		const server = new SocketServer(db, { port });
		return {
			server,
			port,
			url: `ws://localhost:${port}`,
			async stop() {
				await server.close();
			},
		};
	}
}

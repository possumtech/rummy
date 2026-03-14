import { WebSocketServer } from "ws";
import ClientConnection from "./ClientConnection.js";

export default class SocketServer {
	#db;
	#wss;

	constructor(db, options) {
		this.#db = db;
		this.#wss = new WebSocketServer(options);

		this.#wss.on("connection", (ws) => {
			new ClientConnection(ws, this.#db);
		});

		this.#wss.on("error", (err) => {
			if (err.code === "EADDRINUSE") {
				console.error(`Error: Port ${options.port} is already in use.`);
				process.exit(1);
			}
			throw err;
		});
	}

	close() {
		return new Promise((resolve) => {
			this.#wss.close(resolve);
		});
	}
}

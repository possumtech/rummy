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

		this.#wss.on("error", (_err) => {
			// We emit the error so the owner can decide what to do (e.g., process.exit)
			// But we don't kill the process from within the class.
		});
	}

	/**
	 * Exposed for testing to get dynamic port info
	 */
	address() {
		return this.#wss.address();
	}

	/**
	 * Handle error event
	 */
	on(event, handler) {
		this.#wss.on(event, handler);
	}

	close() {
		return new Promise((resolve) => {
			if (!this.#wss) return resolve();
			this.#wss.close(resolve);
		});
	}
}

import { WebSocket } from "ws";

export default class RpcClient {
	#ws;
	#url;

	constructor(url) {
		this.#url = url;
	}

	async connect() {
		this.#ws = new WebSocket(this.#url);
		return new Promise((resolve, reject) => {
			this.#ws.on("open", resolve);
			this.#ws.on("error", reject);
		});
	}

	async call(method, params = {}, id = Math.random().toString(36).slice(2)) {
		return new Promise((resolve, reject) => {
			// Increase timeout for live API calls
			const timeout = setTimeout(
				() => reject(new Error(`RPC Timeout: ${method}`)),
				30000,
			);

			const handler = (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.id === id) {
					clearTimeout(timeout);
					this.#ws.off("message", handler);
					if (msg.error) reject(new Error(msg.error.message));
					else resolve(msg.result);
				}
			};

			this.#ws.on("message", handler);
			this.#ws.send(JSON.stringify({ jsonrpc: "2.0", method, params, id }));
		});
	}

	close() {
		if (this.#ws) this.#ws.close();
	}
}

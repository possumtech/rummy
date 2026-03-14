import ModelAgent from "../agent/ModelAgent.js";

export default class ClientConnection {
	#ws;
	#db;
	#modelAgent;

	constructor(ws, db) {
		this.#ws = ws;
		this.#db = db;
		this.#modelAgent = new ModelAgent(db);

		this.#ws.on("message", (data) => this.#handleMessage(data));
	}

	async #handleMessage(data) {
		try {
			const message = JSON.parse(data.toString());
			if (message.method === "getModels") {
				const models = await this.#modelAgent.getModels();
				this.#send({
					jsonrpc: "2.0",
					result: models,
					id: message.id,
				});
			}
		} catch (error) {
			this.#send({
				jsonrpc: "2.0",
				error: { code: -32603, message: error.message },
				id: null,
			});
		}
	}

	#send(payload) {
		if (this.#ws.readyState === 1) {
			this.#ws.send(JSON.stringify(payload));
		}
	}
}

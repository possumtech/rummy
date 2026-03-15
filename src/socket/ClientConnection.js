import ModelAgent from "../agent/ModelAgent.js";
import ProjectAgent from "../agent/ProjectAgent.js";

export default class ClientConnection {
	#ws;
	#db;
	#projectAgent;
	#modelAgent;
	#context = {
		projectId: null,
		sessionId: null,
		projectPath: null,
	};

	constructor(ws, db) {
		this.#ws = ws;
		this.#db = db;
		this.#projectAgent = new ProjectAgent(db);
		this.#modelAgent = new ModelAgent(db);

		this.#ws.on("message", (data) => this.#handleMessage(data));
	}

	/**
	 * Exposed for testing purposes.
	 */
	async handleMessageForTest(data) {
		return this.#handleMessage(data);
	}

	async #handleMessage(data) {
		let id = null;
		try {
			const message = JSON.parse(data.toString());
			const { method, params, id: msgId } = message;
			id = msgId;

			let result;

			switch (method) {
				case "init":
					result = await this.#projectAgent.init(
						params.projectPath,
						params.projectName,
						params.clientId,
					);
					this.#context.projectId = result.projectId;
					this.#context.sessionId = result.sessionId;
					this.#context.projectPath = params.projectPath;
					break;

				case "getModels":
					result = await this.#modelAgent.getModels();
					break;

				case "getOpenRouterModels":
					result = await this.#modelAgent.getOpenRouterModels();
					break;

				case "getFiles":
					if (!this.#context.projectPath) {
						throw new Error("Project not initialized. Call 'init' first.");
					}
					result = await this.#projectAgent.getFiles(this.#context.projectPath);
					break;

				case "updateFiles":
					if (!this.#context.projectId) {
						throw new Error("Project not initialized. Call 'init' first.");
					}
					// params: { files: [{ path, visibility }] }
					result = await this.#projectAgent.updateFiles(
						this.#context.projectId,
						params.files,
					);
					break;

				case "startJob":
					if (!this.#context.sessionId) {
						throw new Error("Session not initialized. Call 'init' first.");
					}
					result = await this.#projectAgent.startJob(
						this.#context.sessionId,
						params,
					);
					break;

				case "ask":
					if (!this.#context.sessionId) {
						throw new Error("Session not initialized. Call 'init' first.");
					}
					result = await this.#projectAgent.ask(
						this.#context.sessionId,
						params.model,
						params.prompt,
						params.activeFiles || [],
					);
					break;

				default:
					throw new Error(`Method '${method}' not found.`);
			}

			this.#send({
				jsonrpc: "2.0",
				result,
				id,
			});
		} catch (error) {
			this.#send({
				jsonrpc: "2.0",
				error: { code: -32603, message: error.message },
				id: id || null,
			});
		}
	}

	#send(payload) {
		if (this.#ws.readyState === 1) {
			this.#ws.send(JSON.stringify(payload));
		}
	}
}

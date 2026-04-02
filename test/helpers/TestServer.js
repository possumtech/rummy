import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import createHooks from "../../src/hooks/Hooks.js";
import { registerPlugins } from "../../src/plugins/index.js";
import RpcRegistry from "../../src/server/RpcRegistry.js";
import SocketServer from "../../src/server/SocketServer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default class TestServer {
	constructor(server, url, hooks) {
		this.server = server;
		this.url = url;
		this.hooks = hooks;
	}

	static async start(db) {
		const hooks = createHooks(false);
		hooks.rpc.registry = new RpcRegistry();

		const pluginsDir = join(__dirname, "../../src/plugins");
		await registerPlugins([pluginsDir], hooks);

		// Seed a minimal catalog entry for the test model to avoid
		// hitting the OpenRouter /models endpoint on every test file.
		const testModel = process.env.RUMMY_MODEL_DEFAULT;
		if (testModel) {
			const resolved = process.env[`RUMMY_MODEL_${testModel}`];
			if (resolved) {
				try {
					await db.upsert_provider_model.run({
						id: resolved,
						canonical_slug: null,
						name: testModel,
						description: null,
						context_length: 131072,
						modality: null,
						tokenizer: null,
						instruct_type: null,
						input_modalities: "[]",
						output_modalities: "[]",
						pricing_prompt: 0,
						pricing_completion: 0,
						pricing_input_cache_read: 0,
						max_completion_tokens: null,
						is_moderated: 0,
						supported_parameters: '["include_reasoning","temperature"]',
						default_parameters: "{}",
						knowledge_cutoff: null,
						expiration_date: null,
						created: null,
					});
				} catch {}
			}
		}

		const server = new SocketServer(db, { port: 0, hooks });
		const addr = server.address();
		const url = `ws://localhost:${addr.port}`;
		return new TestServer(server, url, hooks);
	}

	async stop() {
		await this.server.close();
	}
}

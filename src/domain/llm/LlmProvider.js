import ModelCapabilities from "../../infrastructure/llm/ModelCapabilities.js";
import OllamaClient from "../../infrastructure/llm/OllamaClient.js";
import OpenRouterClient from "../../infrastructure/llm/OpenRouterClient.js";

export default class LlmProvider {
	#openRouter;
	#ollama;
	#capabilities;

	constructor(hooks) {
		this.#capabilities = new ModelCapabilities();
		this.#openRouter = new OpenRouterClient(
			process.env.OPENROUTER_API_KEY,
			hooks,
			this.#capabilities,
		);

		const ollamaUrl = process.env.OLLAMA_BASE_URL;
		this.#ollama = new OllamaClient(ollamaUrl, hooks);
	}

	get capabilities() {
		return this.#capabilities;
	}

	static resolve(alias) {
		const actual = process.env[`RUMMY_MODEL_${alias}`];
		if (!actual) throw new Error(`Unknown model alias '${alias}'. Define RUMMY_MODEL_${alias} in your environment.`);
		return actual;
	}

	async completion(messages, model, options = {}) {
		const resolvedModel = LlmProvider.resolve(model);

		const temperature =
			options.temperature ??
			(process.env.RUMMY_TEMPERATURE !== undefined
				? Number.parseFloat(process.env.RUMMY_TEMPERATURE)
				: undefined);
		const resolvedOptions = { ...options, temperature };

		if (resolvedModel.startsWith("ollama/")) {
			const localModel = resolvedModel.replace("ollama/", "");
			return this.#ollama.completion(messages, localModel, resolvedOptions);
		}

		return this.#openRouter.completion(
			messages,
			resolvedModel,
			resolvedOptions,
		);
	}

	async getContextSize(model) {
		const resolvedModel = LlmProvider.resolve(model);
		if (resolvedModel.startsWith("ollama/")) {
			const localModel = resolvedModel.replace("ollama/", "");
			return this.#ollama.getContextSize(localModel);
		}
		return this.#openRouter.getContextSize(resolvedModel);
	}
}

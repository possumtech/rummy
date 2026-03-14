export default class ModelAgent {
	#db;

	constructor(db) {
		this.#db = db;
	}

	/**
	 * Returns combined list of DB models and SNORE_MODEL_ environment aliases.
	 */
	async getModels() {
		const dbModels = await this.#db.get_models.all();

		// Add environment-based aliases (e.g., SNORE_MODEL_ccp=openrouter/deepseek-v3)
		const envModels = Object.keys(process.env)
			.filter((key) => key.startsWith("SNORE_MODEL_"))
			.map((key) => {
				const alias = key.replace("SNORE_MODEL_", "");
				return {
					id: alias,
					name: `${alias} (Env Alias)`,
					description: `Alias for ${process.env[key]}`,
					target: process.env[key],
				};
			});

		return [...dbModels, ...envModels];
	}

	/**
	 * Fetches the full list of models from OpenRouter for client-side filtering.
	 */
	async getOpenRouterModels() {
		const apiKey = process.env.OPENROUTER_API_KEY;
		if (!apiKey) throw new Error("OPENROUTER_API_KEY not found in environment");

		const response = await fetch("https://openrouter.ai/api/v1/models", {
			headers: {
				Authorization: `Bearer ${apiKey}`,
			},
		});

		if (!response.ok) {
			throw new Error(`Failed to fetch OpenRouter models: ${response.status}`);
		}

		const data = await response.json();
		return data.data; // OpenRouter returns { data: [...] }
	}
}

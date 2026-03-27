export default class OllamaClient {
	#baseUrl;
	#hooks;

	constructor(baseUrl, hooks) {
		this.#baseUrl = baseUrl;
		this.#hooks = hooks;
	}

	async completion(messages, model, options = {}) {
		const body = { model, messages, think: true };
		if (options.temperature !== undefined)
			body.temperature = options.temperature;

		const response = await fetch(`${this.#baseUrl}/v1/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Ollama API error: ${response.status} - ${error}`);
		}

		const data = await response.json();

		// Ollama uses "reasoning" field; normalize to "reasoning_content" (OpenAI standard)
		for (const choice of data.choices || []) {
			if (choice.message?.reasoning && !choice.message.reasoning_content) {
				choice.message.reasoning_content = choice.message.reasoning;
			}
		}

		return data;
	}

	async getContextSize(model) {
		// Ollama lazy-loads models — first request can be slow.
		// Retry up to 3 times with increasing delays.
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				const response = await fetch(`${this.#baseUrl}/api/show`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ model }),
					signal: AbortSignal.timeout(30_000),
				});
				if (!response.ok) return null;
				const data = await response.json();
				const info = data.model_info || {};
				for (const [key, value] of Object.entries(info)) {
					if (key.endsWith(".context_length")) return value;
				}
				return null;
			} catch {
				if (attempt < 2) {
					await new Promise((r) => setTimeout(r, (attempt + 1) * 2000));
				}
			}
		}
		return null;
	}
}

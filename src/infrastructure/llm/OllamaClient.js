export default class OllamaClient {
	#baseUrl;
	#hooks;

	constructor(baseUrl, hooks) {
		this.#baseUrl = baseUrl;
		this.#hooks = hooks;
	}

	async completion(messages, model, options = {}) {
		const body = { model, messages };
		if (options.temperature !== undefined) body.temperature = options.temperature;

		const response = await fetch(`${this.#baseUrl}/v1/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Ollama API error: ${response.status} - ${error}`);
		}

		return response.json();
	}
}

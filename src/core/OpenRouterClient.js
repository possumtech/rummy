export default class OpenRouterClient {
	#apiKey;
	#baseUrl;

	constructor(apiKey) {
		if (!apiKey) throw new Error("OpenRouterClient: API Key required");
		this.#apiKey = apiKey;
		this.#baseUrl = process.env.OPENROUTER_BASE_URL;
		if (!this.#baseUrl)
			throw new Error("SNORE Configuration Error: OPENROUTER_BASE_URL missing");
	}

	async completion(messages, model) {
		if (!model) throw new Error("OpenRouterClient: Model ID required");

		const response = await fetch(`${this.#baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.#apiKey}`,
				"Content-Type": "application/json",
				"HTTP-Referer": process.env.SNORE_HTTP_REFERER || "",
				"X-Title": process.env.SNORE_X_TITLE || "SNORE",
			},
			body: JSON.stringify({
				model,
				messages,
			}),
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
		}

		return response.json();
	}
}

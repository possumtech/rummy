export default class OpenRouterClient {
	#apiKey;
	#baseUrl = "https://openrouter.ai/api/v1";

	constructor(apiKey) {
		this.#apiKey = apiKey;
	}

	/**
	 * Simple Chat Completion (Paris-ready)
	 * @param {Object[]} messages - OpenAI format [{role, content}]
	 * @param {string} model - OpenRouter model ID
	 * @returns {Promise<Object>} - The raw completion result
	 */
	async completion(messages, model = "gpt-4o") {
		const response = await fetch(`${this.#baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.#apiKey}`,
				"Content-Type": "application/json",
				"HTTP-Referer": "https://github.com/possumtech/snore",
				"X-Title": "SNORE",
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

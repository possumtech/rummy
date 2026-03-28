import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const responseSchema = JSON.parse(
	readFileSync(join(__dirname, "../../domain/schema/response.json"), "utf8"),
);

export default class OpenRouterClient {
	#apiKey;
	#baseUrl;
	#hooks;
	#capabilities;

	constructor(apiKey, hooks, capabilities) {
		this.#apiKey = apiKey;
		this.#hooks = hooks;
		this.#capabilities = capabilities;
		this.#baseUrl = process.env.OPENROUTER_BASE_URL;
	}

	async completion(messages, model, options = {}) {
		if (!this.#apiKey) {
			throw new Error(
				"OpenRouter API key is missing. Please set OPENROUTER_API_KEY in your environment.",
			);
		}

		// Strip prefill if present — structured outputs don't use it
		let finalMessages = messages;
		const lastMsg = messages.at(-1);
		if (lastMsg?.role === "assistant") {
			finalMessages = messages.slice(0, -1);
		}

		return this.#fetch(finalMessages, model, options);
	}

	async #fetch(messages, model, options) {
		const body = { model, messages };
		if (options.temperature !== undefined)
			body.temperature = options.temperature;

		// Use structured outputs if model supports it
		const supportsStructured =
			this.#capabilities?.supports(model, "structured_outputs") ??
			this.#capabilities?.supports(model, "response_format") ??
			false;

		if (supportsStructured) {
			body.response_format = {
				type: "json_schema",
				json_schema: {
					name: "rummy_response",
					strict: true,
					schema: responseSchema,
				},
			};
		}

		const response = await fetch(`${this.#baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.#apiKey}`,
				"Content-Type": "application/json",
				"HTTP-Referer": process.env.RUMMY_HTTP_REFERER,
				"X-Title": process.env.RUMMY_X_TITLE,
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const error = await response.text();
			if (response.status === 401 || response.status === 403) {
				throw new Error(
					`OpenRouter Authentication Error: ${response.status} - ${error}. Please check your OPENROUTER_API_KEY.`,
				);
			}
			throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
		}
		return response.json();
	}

	async getContextSize(model) {
		const response = await fetch(`${this.#baseUrl}/models`, {
			headers: {
				Authorization: `Bearer ${this.#apiKey}`,
			},
		});
		if (!response.ok) return null;
		const data = await response.json();
		const found = data.data?.find((m) => m.id === model);
		if (found && this.#capabilities) {
			this.#capabilities.set(model, found);
		}
		return found?.context_length || null;
	}
}

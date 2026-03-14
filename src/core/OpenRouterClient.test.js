import assert from "node:assert";
import { describe, it, mock } from "node:test";
import OpenRouterClient from "./OpenRouterClient.js";

describe("OpenRouterClient", () => {
	it("should send a completion request and return json", async () => {
		const mockResponse = {
			choices: [{ message: { content: "Paris" } }],
			usage: { total_tokens: 10 },
		};

		const fetchMock = mock.method(globalThis, "fetch", async () => {
			return {
				ok: true,
				json: async () => mockResponse,
			};
		});

		const client = new OpenRouterClient("test-key");
		const result = await client.completion(
			[{ role: "user", content: "Capital of France?" }],
			"gpt-4o",
		);

		assert.deepStrictEqual(result, mockResponse);
		assert.strictEqual(fetchMock.mock.callCount(), 1);

		const [url, options] = fetchMock.mock.calls[0].arguments;
		assert.strictEqual(url, "https://openrouter.ai/api/v1/chat/completions");
		assert.strictEqual(options.headers.Authorization, "Bearer test-key");
	});

	it("should throw an error on non-ok response", async () => {
		mock.method(globalThis, "fetch", async () => {
			return {
				ok: false,
				status: 401,
				text: async () => "Unauthorized",
			};
		});

		const client = new OpenRouterClient("invalid-key");
		await assert.rejects(
			client.completion([], "gpt-4o"),
			/OpenRouter API error: 401 - Unauthorized/,
		);
	});
});

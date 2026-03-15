import assert from "node:assert";
import { before, describe, it, mock } from "node:test";
import OpenRouterClient from "./OpenRouterClient.js";

describe("OpenRouterClient", () => {
	before(() => {
		process.env.OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
	});

	it("should throw if API key is missing", () => {
		assert.throws(() => new OpenRouterClient(null), /API Key required/);
	});

	it("should throw if base URL is missing", () => {
		const original = process.env.OPENROUTER_BASE_URL;
		delete process.env.OPENROUTER_BASE_URL;
		assert.throws(
			() => new OpenRouterClient("key"),
			/OPENROUTER_BASE_URL missing/,
		);
		process.env.OPENROUTER_BASE_URL = original;
	});

	it("should send a completion request", async () => {
		const mockResponse = {
			choices: [{ message: { content: "Paris" } }],
			usage: { total_tokens: 10 },
		};

		mock.method(globalThis, "fetch", async () => ({
			ok: true,
			json: async () => mockResponse,
		}));

		const client = new OpenRouterClient("test-key");
		const result = await client.completion(
			[{ role: "user", content: "Paris?" }],
			"gpt-4o",
		);

		assert.deepStrictEqual(result, mockResponse);
	});

	it("should throw on API error", async () => {
		mock.method(globalThis, "fetch", async () => ({
			ok: false,
			status: 500,
			text: async () => "Internal Error",
		}));

		const client = new OpenRouterClient("test-key");
		await assert.rejects(
			client.completion([], "gpt-4o"),
			/OpenRouter API error: 500 - Internal Error/,
		);
	});
});

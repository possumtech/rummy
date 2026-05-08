import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import Google from "./google.js";

describe("Google provider plugin", () => {
	let originalKeyFile;
	let originalFetch;
	let tmpKey;

	beforeEach(async () => {
		originalKeyFile = process.env.RUMMY_GEMINI_KEY_FILE;
		originalFetch = globalThis.fetch;
		tmpKey = join(
			tmpdir(),
			`google_test_${Date.now()}_${Math.random().toString(36).slice(2)}.key`,
		);
	});

	afterEach(async () => {
		if (originalKeyFile === undefined) delete process.env.RUMMY_GEMINI_KEY_FILE;
		else process.env.RUMMY_GEMINI_KEY_FILE = originalKeyFile;
		globalThis.fetch = originalFetch;
		await fs.rm(tmpKey, { force: true });
	});

	function mockCore() {
		const providers = [];
		return { providers, hooks: { llm: { providers } } };
	}

	it("inert when key file is missing", async () => {
		process.env.RUMMY_GEMINI_KEY_FILE = `${tmpKey}.does-not-exist`;
		const core = mockCore();
		new Google(core);
		assert.equal(core.providers.length, 0);
	});

	it("inert when key file is empty", async () => {
		await fs.writeFile(tmpKey, "  \n  ");
		process.env.RUMMY_GEMINI_KEY_FILE = tmpKey;
		const core = mockCore();
		new Google(core);
		assert.equal(core.providers.length, 0);
	});

	it("registers provider when key file has content", async () => {
		await fs.writeFile(tmpKey, "fake-key-value\n");
		process.env.RUMMY_GEMINI_KEY_FILE = tmpKey;
		const core = mockCore();
		new Google(core);
		assert.equal(core.providers.length, 1);
		assert.equal(core.providers[0].name, "google");
	});

	it("matches model aliases starting with google/", async () => {
		await fs.writeFile(tmpKey, "fake-key");
		process.env.RUMMY_GEMINI_KEY_FILE = tmpKey;
		const core = mockCore();
		new Google(core);
		const provider = core.providers[0];
		assert.equal(provider.matches("google/gemma-4-26b-a4b-it"), true);
		assert.equal(provider.matches("google/gemini-3.1-pro"), true);
		assert.equal(provider.matches("openrouter/google/gemma"), false);
		assert.equal(provider.matches("xai/grok"), false);
	});

	it("getContextSize: returns inputTokenLimit from native /v1beta/models/{model}", async () => {
		await fs.writeFile(tmpKey, "fake-key");
		process.env.RUMMY_GEMINI_KEY_FILE = tmpKey;
		globalThis.fetch = async (url) => {
			assert.match(
				url,
				/generativelanguage\.googleapis\.com\/v1beta\/models\/gemma-4-26b-a4b-it\?key=fake-key$/,
			);
			return {
				ok: true,
				json: async () => ({
					name: "models/gemma-4-26b-a4b-it",
					inputTokenLimit: 131072,
					outputTokenLimit: 8192,
				}),
			};
		};
		const core = mockCore();
		new Google(core);
		const ctx = await core.providers[0].getContextSize(
			"google/gemma-4-26b-a4b-it",
		);
		assert.equal(ctx, 131072);
	});

	it("getContextSize: caches after first lookup", async () => {
		await fs.writeFile(tmpKey, "fake-key");
		process.env.RUMMY_GEMINI_KEY_FILE = tmpKey;
		let callCount = 0;
		globalThis.fetch = async () => {
			callCount++;
			return {
				ok: true,
				json: async () => ({ inputTokenLimit: 32768 }),
			};
		};
		const core = mockCore();
		new Google(core);
		const provider = core.providers[0];
		await provider.getContextSize("google/gemma-26");
		await provider.getContextSize("google/gemma-26");
		assert.equal(callCount, 1, "second call hit cache");
	});

	it("getContextSize: throws on missing inputTokenLimit", async () => {
		await fs.writeFile(tmpKey, "fake-key");
		process.env.RUMMY_GEMINI_KEY_FILE = tmpKey;
		globalThis.fetch = async () => ({
			ok: true,
			json: async () => ({ name: "models/x" }),
		});
		const core = mockCore();
		new Google(core);
		await assert.rejects(
			() => core.providers[0].getContextSize("google/x"),
			/no inputTokenLimit/,
		);
	});
});

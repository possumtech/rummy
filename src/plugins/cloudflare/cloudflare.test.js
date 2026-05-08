import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import Cloudflare from "./cloudflare.js";

describe("Cloudflare provider plugin", () => {
	let originalKeyFile;
	let originalAccountId;
	let originalFetch;
	let tmpKey;

	beforeEach(async () => {
		originalKeyFile = process.env.RUMMY_CLOUDFLARE_KEY_FILE;
		originalAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
		originalFetch = globalThis.fetch;
		tmpKey = join(
			tmpdir(),
			`cloudflare_test_${Date.now()}_${Math.random().toString(36).slice(2)}.key`,
		);
	});

	afterEach(async () => {
		if (originalKeyFile === undefined)
			delete process.env.RUMMY_CLOUDFLARE_KEY_FILE;
		else process.env.RUMMY_CLOUDFLARE_KEY_FILE = originalKeyFile;
		if (originalAccountId === undefined)
			delete process.env.CLOUDFLARE_ACCOUNT_ID;
		else process.env.CLOUDFLARE_ACCOUNT_ID = originalAccountId;
		globalThis.fetch = originalFetch;
		await fs.rm(tmpKey, { force: true });
	});

	function mockCore() {
		const providers = [];
		return { providers, hooks: { llm: { providers } } };
	}

	it("inert when CLOUDFLARE_ACCOUNT_ID is missing", async () => {
		delete process.env.CLOUDFLARE_ACCOUNT_ID;
		await fs.writeFile(tmpKey, "key");
		process.env.RUMMY_CLOUDFLARE_KEY_FILE = tmpKey;
		const core = mockCore();
		new Cloudflare(core);
		assert.equal(core.providers.length, 0);
	});

	it("inert when key file is missing", async () => {
		process.env.CLOUDFLARE_ACCOUNT_ID = "abc123";
		process.env.RUMMY_CLOUDFLARE_KEY_FILE = `${tmpKey}.does-not-exist`;
		const core = mockCore();
		new Cloudflare(core);
		assert.equal(core.providers.length, 0);
	});

	it("registers provider when both key and account ID are present", async () => {
		process.env.CLOUDFLARE_ACCOUNT_ID = "abc123";
		await fs.writeFile(tmpKey, "fake-key\n");
		process.env.RUMMY_CLOUDFLARE_KEY_FILE = tmpKey;
		const core = mockCore();
		new Cloudflare(core);
		assert.equal(core.providers.length, 1);
		assert.equal(core.providers[0].name, "cloudflare");
	});

	it("matches model aliases starting with @cf/", async () => {
		process.env.CLOUDFLARE_ACCOUNT_ID = "abc123";
		await fs.writeFile(tmpKey, "fake-key");
		process.env.RUMMY_CLOUDFLARE_KEY_FILE = tmpKey;
		const core = mockCore();
		new Cloudflare(core);
		const provider = core.providers[0];
		assert.equal(provider.matches("@cf/google/gemma-4-26b-a4b-it"), true);
		assert.equal(provider.matches("@cf/meta/llama-3"), true);
		assert.equal(provider.matches("openrouter/x"), false);
		assert.equal(provider.matches("xai/grok"), false);
	});

	it("getContextSize: extracts context_window from models-search", async () => {
		process.env.CLOUDFLARE_ACCOUNT_ID = "abc123";
		await fs.writeFile(tmpKey, "fake-key");
		process.env.RUMMY_CLOUDFLARE_KEY_FILE = tmpKey;
		globalThis.fetch = async (url, init) => {
			assert.match(
				url,
				/api\.cloudflare\.com\/client\/v4\/accounts\/abc123\/ai\/models\/search\?search=/,
			);
			assert.equal(init.headers.Authorization, "Bearer fake-key");
			return {
				ok: true,
				json: async () => ({
					result: [
						{
							name: "@cf/google/gemma-4-26b-a4b-it",
							properties: [
								{ property_id: "max_input_tokens", value: "8192" },
								{ property_id: "context_window", value: "131072" },
							],
						},
					],
				}),
			};
		};
		const core = mockCore();
		new Cloudflare(core);
		const ctx = await core.providers[0].getContextSize(
			"@cf/google/gemma-4-26b-a4b-it",
		);
		assert.equal(ctx, 131072);
	});

	it("getContextSize: caches after first lookup", async () => {
		process.env.CLOUDFLARE_ACCOUNT_ID = "abc123";
		await fs.writeFile(tmpKey, "fake-key");
		process.env.RUMMY_CLOUDFLARE_KEY_FILE = tmpKey;
		let callCount = 0;
		globalThis.fetch = async () => {
			callCount++;
			return {
				ok: true,
				json: async () => ({
					result: [
						{
							name: "@cf/x",
							properties: [{ property_id: "context_window", value: "32768" }],
						},
					],
				}),
			};
		};
		const core = mockCore();
		new Cloudflare(core);
		const provider = core.providers[0];
		await provider.getContextSize("@cf/x");
		await provider.getContextSize("@cf/x");
		assert.equal(callCount, 1);
	});

	it("getContextSize: throws when model not in search results", async () => {
		process.env.CLOUDFLARE_ACCOUNT_ID = "abc123";
		await fs.writeFile(tmpKey, "fake-key");
		process.env.RUMMY_CLOUDFLARE_KEY_FILE = tmpKey;
		globalThis.fetch = async () => ({
			ok: true,
			json: async () => ({ result: [] }),
		});
		const core = mockCore();
		new Cloudflare(core);
		await assert.rejects(
			() => core.providers[0].getContextSize("@cf/missing"),
			/not found in models-search/,
		);
	});

	it("getContextSize: throws on missing context property", async () => {
		process.env.CLOUDFLARE_ACCOUNT_ID = "abc123";
		await fs.writeFile(tmpKey, "fake-key");
		process.env.RUMMY_CLOUDFLARE_KEY_FILE = tmpKey;
		globalThis.fetch = async () => ({
			ok: true,
			json: async () => ({
				result: [{ name: "@cf/x", properties: [] }],
			}),
		});
		const core = mockCore();
		new Cloudflare(core);
		await assert.rejects(
			() => core.providers[0].getContextSize("@cf/x"),
			/no context_window or max_input_tokens/,
		);
	});
});

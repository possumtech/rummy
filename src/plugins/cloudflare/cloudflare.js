import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import msg from "../../agent/messages.js";
import { chatCompletionStream } from "../../llm/openaiStream.js";

const FETCH_TIMEOUT = Number(process.env.RUMMY_FETCH_TIMEOUT);

const PROVIDER = "@cf";

// Repo-root-relative key file. Resolved relative to this source file so
// CWD changes during runs (programbench/tbench cd into workspaces) don't
// break the lookup. Plugin is inert if the file is missing OR if
// CLOUDFLARE_ACCOUNT_ID is unset (the API path is account-scoped).
const __dirname = dirname(fileURLToPath(import.meta.url));
function resolveKeyFile() {
	return process.env.RUMMY_CLOUDFLARE_KEY_FILE
		? process.env.RUMMY_CLOUDFLARE_KEY_FILE
		: join(__dirname, "..", "..", "..", "cloudflare.key");
}

// Inert unless cloudflare.key exists and CLOUDFLARE_ACCOUNT_ID is set.
// Matches model aliases starting with `@cf/` — Cloudflare Workers AI's
// own namespace, used verbatim with no prefix stripping
// (`@cf/google/gemma-4-26b-a4b-it`).
//
// Uses Cloudflare's OpenAI-compatible endpoint
// (`/v1/chat/completions`) so the streaming SSE accumulator is shared
// with the other OpenAI-shaped providers. Context-size lookups go to
// the native models-search API which exposes `properties` including
// the model's context window.
export default class Cloudflare {
	#apiKey;
	#accountId;
	#contextCache = new Map();

	constructor(core) {
		const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
		if (!accountId) return;
		const keyFile = resolveKeyFile();
		if (!existsSync(keyFile)) return;
		const raw = readFileSync(keyFile, "utf8").trim();
		if (!raw) return;
		this.#apiKey = raw;
		this.#accountId = accountId;

		core.hooks.llm.providers.push({
			name: "cloudflare",
			matches: (model) => model.split("/")[0] === PROVIDER,
			completion: (messages, model, options) =>
				this.#completion(messages, model, options),
			getContextSize: (model) => this.#getContextSize(model),
		});
	}

	#baseUrl() {
		return `https://api.cloudflare.com/client/v4/accounts/${this.#accountId}/ai`;
	}

	async #completion(messages, model, options = {}) {
		const body = { model, messages };
		if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
		if (options.temperature !== undefined)
			body.temperature = options.temperature;

		const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT);
		const signal = options.signal
			? AbortSignal.any([options.signal, timeoutSignal])
			: timeoutSignal;

		const headers = { Authorization: `Bearer ${this.#apiKey}` };

		try {
			return await chatCompletionStream({
				url: `${this.#baseUrl()}/v1/chat/completions`,
				headers,
				body,
				signal,
			});
		} catch (err) {
			if (err.status === 401 || err.status === 403) {
				throw new Error(
					msg("error.cloudflare_auth", {
						status: `${err.status} - ${err.body}`,
					}),
				);
			}
			if (err.status) {
				throw new Error(
					msg("error.cloudflare_api", {
						status: `${err.status} - ${err.body}`,
					}),
				);
			}
			throw err;
		}
	}

	async #getContextSize(model) {
		if (this.#contextCache.has(model)) return this.#contextCache.get(model);

		// Cloudflare's models-search returns model metadata including
		// `properties` (an array with `property_id` / `value` pairs).
		// `context_window` (or `max_input_tokens` on some entries) is
		// the field we want.
		const url = `${this.#baseUrl()}/models/search?search=${encodeURIComponent(model)}`;
		const res = await fetch(url, {
			headers: { Authorization: `Bearer ${this.#apiKey}` },
			signal: AbortSignal.timeout(FETCH_TIMEOUT),
		});
		if (!res.ok) {
			throw new Error(
				msg("error.cloudflare_models_failed", { model, status: res.status }),
			);
		}
		const data = await res.json();
		const entry = data.result.find((m) => m.name === model);
		if (!entry) {
			throw new Error(msg("error.cloudflare_model_not_found", { model }));
		}
		const props = entry.properties;
		// Prefer `context_window` (full prompt+output combined) over
		// `max_input_tokens` (input-only). Some Cloudflare entries have
		// both, some only one. Picking the larger one is wrong (would
		// pick input cap when context is what we want); explicit priority.
		const ctxProp =
			props.find((p) => p.property_id === "context_window") ??
			props.find((p) => p.property_id === "max_input_tokens");
		const ctx = ctxProp ? Number(ctxProp.value) : null;
		if (!ctx) {
			throw new Error(msg("error.cloudflare_no_context_length", { model }));
		}
		this.#contextCache.set(model, ctx);
		return ctx;
	}
}

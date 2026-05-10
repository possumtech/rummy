import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import msg from "../../agent/messages.js";
import { chatCompletionStream } from "../../llm/openaiStream.js";

const FETCH_TIMEOUT = Number(process.env.RUMMY_FETCH_TIMEOUT);

const PROVIDER = "google";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const COMPAT_URL = `${BASE_URL}/openai`;

// Documented input-token limits, prefix-matched. The native introspection
// endpoint (/v1beta/models/{model}) requires a key permission separate from
// generateContent — keys provisioned for chat-only return 403 here, crashing
// any run that depends on the lookup. Trust the docs first; hit the API only
// for unknown models.
const KNOWN_CONTEXT = [
	["gemini-3.1-flash-lite", 1_048_576],
	["gemini-3.1-flash", 1_048_576],
	["gemini-3.1-pro", 1_048_576],
	["gemini-3.0", 1_048_576],
	["gemini-2.5", 1_048_576],
	["gemini-2.0", 1_048_576],
	["gemini-1.5", 1_048_576],
];

// Repo-root-relative key file. Resolved relative to this source file so
// CWD changes during runs (programbench/tbench cd into workspaces) don't
// break the lookup. Plugin is inert if the file is missing. Tests may
// override the path via `RUMMY_GEMINI_KEY_FILE` to point at a tmpdir
// fixture; the env var is a path knob, not a runtime fallback.
const __dirname = dirname(fileURLToPath(import.meta.url));
function resolveKeyFile() {
	return process.env.RUMMY_GEMINI_KEY_FILE
		? process.env.RUMMY_GEMINI_KEY_FILE
		: join(__dirname, "..", "..", "..", "gemini.key");
}

// Inert unless gemini.key exists in repo root; google/{model} aliases.
//
// Uses Google AI Studio's OpenAI-compatible endpoint
// (`/v1beta/openai/chat/completions`) for completions so we share the
// streaming SSE accumulator with the other OpenAI-shaped providers.
// Context-size lookups go to the native endpoint
// (`/v1beta/models/{model}`) because the OpenAI-compat /models response
// drops `inputTokenLimit`.
//
// Auth is `Authorization: Bearer {key}` on both endpoints; the legacy
// `?key={key}` query-param form is supported by Google but the bearer
// form is consistent with our other plugins.
export default class Google {
	#apiKey;
	#contextCache = new Map();

	constructor(core) {
		const keyFile = resolveKeyFile();
		if (!existsSync(keyFile)) return;
		const raw = readFileSync(keyFile, "utf8").trim();
		if (!raw) return;
		this.#apiKey = raw;

		const wireModel = (alias) => alias.split("/").slice(1).join("/");

		core.hooks.llm.providers.push({
			name: PROVIDER,
			matches: (model) => model.split("/")[0] === PROVIDER,
			completion: (messages, model, options) =>
				this.#completion(messages, wireModel(model), options),
			getContextSize: (model) => this.#getContextSize(wireModel(model)),
		});
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
				url: `${COMPAT_URL}/chat/completions`,
				headers,
				body,
				signal,
			});
		} catch (err) {
			if (err.status === 401 || err.status === 403) {
				throw new Error(
					msg("error.google_auth", { status: `${err.status} - ${err.body}` }),
				);
			}
			if (err.status) {
				throw new Error(
					msg("error.google_api", { status: `${err.status} - ${err.body}` }),
				);
			}
			throw err;
		}
	}

	async #getContextSize(model) {
		if (this.#contextCache.has(model)) return this.#contextCache.get(model);

		const known = KNOWN_CONTEXT.find(([prefix]) => model.startsWith(prefix));
		if (known) {
			this.#contextCache.set(model, known[1]);
			return known[1];
		}

		// /v1beta/models/{model} requires `?key=` (Bearer 401s here) AND a
		// key scope that includes models.get — chat-only keys return 403.
		const url = `${BASE_URL}/models/${model}?key=${encodeURIComponent(this.#apiKey)}`;
		const res = await fetch(url, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT),
		});
		if (!res.ok) {
			throw new Error(
				msg("error.google_models_failed", { model, status: res.status }),
			);
		}
		const data = await res.json();
		const ctx = data?.inputTokenLimit;
		if (!ctx) throw new Error(msg("error.google_no_context_length", { model }));
		this.#contextCache.set(model, ctx);
		return ctx;
	}
}

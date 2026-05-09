import msg from "../agent/messages.js";
import {
	ContextExceededError,
	classifyTransient,
	isContextExceededMessage,
} from "./errors.js";
import { retryClassified } from "./retry.js";

const LLM_DEADLINE = Number(process.env.RUMMY_LLM_DEADLINE);
const LLM_MAX_BACKOFF = Number(process.env.RUMMY_LLM_MAX_BACKOFF);

const TOKEN_DIVISOR = Number(process.env.RUMMY_TOKEN_DIVISOR);
// Floor so a near-full prompt still leaves room for a closing `<update>`.
const MAX_TOKENS_FLOOR = 1024;
// 1−X headroom absorbs BPE/estimator drift and envelope overhead.
const BUDGET_CEILING = Number(process.env.RUMMY_BUDGET_CEILING);

const POLICIES = Object.freeze({
	gateway: { deadlineMs: 30_000, baseDelayMs: 500, maxDelayMs: 5_000 },
	warmup: {
		deadlineMs: LLM_DEADLINE,
		baseDelayMs: 2000,
		maxDelayMs: LLM_MAX_BACKOFF,
	},
	rate_limit: {
		deadlineMs: LLM_DEADLINE,
		baseDelayMs: 1000,
		maxDelayMs: LLM_MAX_BACKOFF,
	},
	server: { deadlineMs: 60_000, baseDelayMs: 1000, maxDelayMs: 10_000 },
});

export default class LlmProvider {
	#db;
	#hooks;

	constructor(db, hooks) {
		this.#db = db;
		this.#hooks = hooks;
	}

	async resolve(alias) {
		const row = await this.#db.get_model_by_alias.get({ alias });
		if (row) return row.actual;
		throw new Error(msg("error.model_alias_unknown", { alias }));
	}

	#selectProvider(modelAlias) {
		return this.#hooks.llm.providers.find((p) => p.matches(modelAlias));
	}

	async completion(messages, model, options = {}) {
		const resolvedModel = await this.resolve(model);

		const temperature =
			options.temperature ??
			(process.env.RUMMY_TEMPERATURE !== undefined
				? Number.parseFloat(process.env.RUMMY_TEMPERATURE)
				: undefined);

		// max_tokens = effectiveContext − promptEstimate. lastPromptTokens
		// is ground truth when available (turn 1 falls back to chars/divisor).
		const contextLength = await this.getContextSize(model);
		const promptEstimate =
			options.lastPromptTokens > 0
				? options.lastPromptTokens
				: messages.reduce(
						(sum, m) => sum + Math.ceil(m.content.length / TOKEN_DIVISOR),
						0,
					);
		const effectiveContext = Math.floor(contextLength * BUDGET_CEILING);
		let maxTokens = Math.max(
			MAX_TOKENS_FLOOR,
			effectiveContext - promptEstimate,
		);
		// Per-model output cap (`RUMMY_OUTPUT_CAP_<alias>`) — output ceilings
		// are typically far smaller than advertised context windows.
		const outputCapEnv = process.env[`RUMMY_OUTPUT_CAP_${model}`];
		if (outputCapEnv) {
			const cap = Number.parseInt(outputCapEnv, 10);
			if (cap > 0) maxTokens = Math.min(maxTokens, cap);
		}
		const resolvedOptions = { ...options, temperature, maxTokens };

		const provider = this.#selectProvider(resolvedModel);
		if (!provider) {
			throw new Error(
				`No LLM provider registered for model "${resolvedModel}". ` +
					`Check your RUMMY_* env vars or register a provider plugin.`,
			);
		}

		try {
			return await retryClassified(
				() => provider.completion(messages, resolvedModel, resolvedOptions),
				{
					signal: options.signal,
					classify: classifyTransient,
					policies: POLICIES,
					onRetry: (err, category, attempt, delayMs, remainingMs) => {
						console.error(
							`[LLM] ${category} on ${provider.name} attempt ${attempt}: ${err.message}; retrying in ${delayMs}ms (${Math.round(remainingMs / 1000)}s ${category} budget remaining)`,
						);
					},
				},
			);
		} catch (err) {
			if (isContextExceededMessage(err.message)) {
				throw new ContextExceededError(err.message, { cause: err });
			}
			throw err;
		}
	}

	async getContextSize(model) {
		const row = await this.#db.get_model_by_alias.get({ alias: model });
		if (row?.context_length) return row.context_length;

		const resolvedModel = await this.resolve(model);
		const provider = this.#selectProvider(resolvedModel);
		if (!provider) {
			throw new Error(
				`No LLM provider registered for model "${resolvedModel}".`,
			);
		}
		const size = await provider.getContextSize(resolvedModel);
		await this.#db.update_model_context_length.run({
			alias: model,
			context_length: size,
		});
		return size;
	}
}

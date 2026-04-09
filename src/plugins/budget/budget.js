import { countTokens } from "../../agent/tokens.js";

/**
 * Budget plugin: measures context and enforces ceiling.
 *
 * Returns { messages, rows, assembledTokens, status }
 * status 200 = fits. status 413 = over budget, needs housekeeping.
 */

function measureMessages(messages) {
	return messages.reduce((sum, m) => sum + countTokens(m.content), 0);
}

export default class Budget {
	#core;

	constructor(core) {
		this.#core = core;
		core.hooks.budget = { enforce: this.enforce.bind(this) };
	}

	async enforce({ contextSize, messages, rows }) {
		if (!contextSize) {
			return { messages, rows, demoted: [], assembledTokens: 0, status: 200 };
		}

		const assembledTokens = measureMessages(messages);

		console.warn(
			`[RUMMY] Budget enforce: ${assembledTokens} tokens, ceiling ${contextSize}, ${rows.length} rows`,
		);

		if (assembledTokens > contextSize) {
			const overflow = assembledTokens - contextSize;
			console.warn(
				`[RUMMY] Budget 413: ${assembledTokens} tokens > ${contextSize} ceiling (${overflow} over)`,
			);
			return {
				messages,
				rows,
				demoted: [],
				assembledTokens,
				status: 413,
				overflow,
			};
		}

		return { messages, rows, demoted: [], assembledTokens, status: 200 };
	}
}

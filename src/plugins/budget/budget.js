import { countTokens } from "../../agent/tokens.js";

const CEILING_RATIO = Number(process.env.RUMMY_BUDGET_CEILING);
if (!CEILING_RATIO) throw new Error("RUMMY_BUDGET_CEILING must be set");

function measureMessages(messages) {
	return messages.reduce((sum, m) => sum + countTokens(m.content), 0);
}

export default class Budget {
	#core;

	constructor(core) {
		this.#core = core;
		core.registerScheme({
			name: "budget",
			modelVisible: 1,
			category: "logging",
		});
		core.hooks.tools.onView("budget", (entry) => entry.body);
		core.hooks.budget = {
			enforce: this.enforce.bind(this),
		};
	}

	async enforce({ contextSize, messages, rows, lastPromptTokens = 0 }) {
		if (!contextSize) {
			return { messages, rows, demoted: [], assembledTokens: 0, status: 200 };
		}

		// Prefer actual prompt_tokens from the last API response — the estimate
		// from measureMessages can be wildly off for structured/XML-heavy content.
		const assembledTokens =
			lastPromptTokens > 0 ? lastPromptTokens : measureMessages(messages);

		console.warn(
			`[RUMMY] Budget enforce: ${assembledTokens} tokens (${lastPromptTokens > 0 ? "actual" : "estimated"}), ceiling ${contextSize}, ${rows.length} rows`,
		);

		const ceiling = Math.floor(contextSize * CEILING_RATIO);
		if (assembledTokens > ceiling) {
			const overflow = assembledTokens - ceiling;
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

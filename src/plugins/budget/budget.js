import { countTokens } from "../../agent/tokens.js";
import BudgetGuard, { BudgetExceeded } from "./BudgetGuard.js";

function measureMessages(messages) {
	return messages.reduce((sum, m) => sum + countTokens(m.content), 0);
}

export { BudgetExceeded };

export default class Budget {
	#core;

	constructor(core) {
		this.#core = core;
		core.hooks.budget = {
			enforce: this.enforce.bind(this),
			activate: this.activate.bind(this),
			deactivate: this.deactivate.bind(this),
			panicPrompt: Budget.panicPrompt,
			BudgetExceeded,
		};
	}

	static panicPrompt({ assembledTokens, contextSize }) {
		const target = Math.floor(contextSize * 0.75);
		const mustFree = assembledTokens - target;
		return [
			`CONTEXT OVERFLOW: ${assembledTokens} tokens, ceiling ${contextSize}.`,
			`YOU MUST free ${mustFree} tokens to get below ${target} (75%).`,
			"YOU MUST NOT load or create new content. Only reduce.",
			"",
			"<knowns> above shows each entry with its token count.",
			"Target the largest entries first.",
			'<rm path="..."/> to delete entries you no longer need.',
			'<set path="..." fidelity="summary" summary="keywords"/> to compress.',
			'<set path="..." fidelity="stored"/> to archive out of context.',
			"<summarize/> when done. <update/> if still working.",
		].join("\n");
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

	activate(store, contextSize, assembledTokens) {
		const guard = new BudgetGuard(contextSize, assembledTokens);
		store.budgetGuard = guard;
		return guard;
	}

	deactivate(store) {
		store.budgetGuard = null;
	}
}

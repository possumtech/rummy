const CEILING_RATIO = Number(process.env.RUMMY_BUDGET_CEILING);
if (!CEILING_RATIO) throw new Error("RUMMY_BUDGET_CEILING must be set");

export default class Progress {
	#core;

	constructor(core) {
		this.#core = core;
		core.filter("assembly.user", this.assembleProgress.bind(this), 200);
	}

	async assembleProgress(content, ctx) {
		const { lastContextTokens, contextSize, baselineTokens } = ctx;
		const lines = [];

		if (contextSize) {
			const ceiling = Math.floor(contextSize * CEILING_RATIO);
			const tokenBudget = Math.max(0, ceiling - (baselineTokens || 0));
			const used = Math.max(0, lastContextTokens - (baselineTokens || 0));
			const remaining = Math.max(0, tokenBudget - used);
			lines.push(
				`Using ${used} of ${tokenBudget} tokens. ${remaining} tokens remaining. Promote relevant entries with <get/> or set fidelity="promoted" to spend tokens. Demote irrelevant entries with set fidelity="demoted" to save tokens.`,
			);
		}
		lines.push(
			"Conclude with a brief <update></update> to continue or a brief <summarize></summarize> if done.",
		);
		const body = lines.join("\n");

		return `${content}<progress turn="${ctx.turn}">${body}</progress>\n`;
	}
}

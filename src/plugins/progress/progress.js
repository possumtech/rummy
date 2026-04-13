export default class Progress {
	#core;

	constructor(core) {
		this.#core = core;
		core.filter("assembly.user", this.assembleProgress.bind(this), 200);
	}

	async assembleProgress(content, ctx) {
		const { lastContextTokens: usedTokens, contextSize } = ctx;
		const pct = contextSize ? Math.round((usedTokens / contextSize) * 100) : 0;

		const loggingEntries = ctx.rows.filter((r) => r.category === "logging");
		const hasPerformed = loggingEntries.some(
			(r) => r.source_turn >= ctx.loopStartTurn,
		);

		const parts = [];

		if (contextSize) {
			parts.push(
				`Using ${usedTokens} tokens (${pct}%) of ${contextSize} token budget. Do not exceed token budget. Use <get/> or set entry fidelity to "full" to spend tokens. Set entry fidelity to "summary" to save tokens.`,
			);
		}

		if (hasPerformed) {
			parts.push(
				"The above actions were performed in response to the following prompt:",
			);
		}

		return `${content}<progress turn="${ctx.turn}">${parts.join("\n")}</progress>\n`;
	}
}

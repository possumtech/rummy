export default class Progress {
	#core;

	constructor(core) {
		this.#core = core;
		core.filter("assembly.user", this.assembleProgress.bind(this), 200);
	}

	async assembleProgress(content, ctx) {
		const { lastContextTokens: usedTokens, contextSize } = ctx;
		const pct = contextSize ? Math.round((usedTokens / contextSize) * 100) : 0;

		const body = contextSize
			? `Using ${usedTokens} tokens (${pct}%) of ${contextSize} token budget. Use <get/> or set entry fidelity to "full" to spend tokens. Set entry fidelity to "summary" to save tokens.`
			: "";

		return `${content}<progress turn="${ctx.turn}">${body}</progress>\n`;
	}
}

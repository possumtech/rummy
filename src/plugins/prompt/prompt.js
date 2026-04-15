export default class Prompt {
	#core;

	constructor(core) {
		this.#core = core;
		core.hooks.tools.onView("prompt", (entry) => entry.body, "promoted");
		core.hooks.tools.onView(
			"prompt",
			(entry) => {
				const limit = 500;
				const text = entry.body?.slice(0, limit) || "";
				return text.length < (entry.body?.length || 0)
					? `${text}\n[truncated — promote to see the complete prompt]`
					: text;
			},
			"demoted",
		);
		core.on("turn.started", this.onTurnStarted.bind(this));
		core.filter("assembly.user", this.assemblePrompt.bind(this), 300);
	}

	async onTurnStarted({ rummy, mode, prompt, isContinuation }) {
		const { entries: store, sequence: turn, runId, loopId } = rummy;

		if (!isContinuation && prompt) {
			await store.upsert(runId, turn, `prompt://${turn}`, prompt, 200, {
				attributes: { mode },
				loopId,
			});
		}
	}

	async assemblePrompt(content, ctx) {
		const promptEntry = ctx.rows.findLast(
			(r) => r.category === "prompt" && r.scheme === "prompt",
		);

		const attrs =
			typeof promptEntry?.attributes === "string"
				? JSON.parse(promptEntry.attributes)
				: promptEntry?.attributes;
		const mode = attrs?.mode || ctx.type;
		const body = promptEntry?.body || "";
		// No tools="..." attribute. The OpenAI-shaped
		// `<prompt mode tools="x,y,z">` rendering was priming gemma's
		// native-tool-call training prior — A/B test confirmed removing
		// the attribute dropped native-format emissions from ~50% to 0%.
		// Tools list lives in the system prompt as "XML Command Tools:".
		let warn = "";
		if (mode === "ask") warn = ' warn="File editing disallowed."';

		return `${content}<prompt mode="${mode}"${warn}>${body}</prompt>`;
	}
}

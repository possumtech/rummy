import { renderEntry } from "../helpers.js";

export default class Prompt {
	#core;

	constructor(core) {
		this.#core = core;
		core.hooks.tools.onView("prompt", (entry) => entry.body);
		core.on("turn.started", this.onTurnStarted.bind(this));
		core.filter("assembly.user", this.assemblePrompt.bind(this), 30);
	}

	async onTurnStarted({ rummy, mode, prompt, isContinuation }) {
		const { entries: store, sequence: turn, runId, loopId } = rummy;

		if (!isContinuation && prompt) {
			await store.set({
				runId,
				turn,
				path: `prompt://${turn}`,
				body: prompt,
				state: "resolved",
				attributes: { mode },
				loopId,
				writer: "plugin",
			});
		}
	}

	async assemblePrompt(content, ctx) {
		const { rows, toolSet } = ctx;
		const promptEntry = rows.findLast(
			(r) => r.category === "prompt" && r.scheme === "prompt",
		);

		const attrs =
			typeof promptEntry?.attributes === "string"
				? JSON.parse(promptEntry.attributes)
				: promptEntry?.attributes;
		const mode = attrs?.mode ? attrs.mode : ctx.type;
		const body = promptEntry ? promptEntry.body : "";
		const activeTools = toolSet
			? new Set(toolSet)
			: new Set(this.#core.hooks.tools.names);
		const commands = this.#core.hooks.tools.advertisedNames
			.filter((n) => activeTools.has(n))
			.join(",");
		let warn = "";
		if (mode === "ask") warn = ' warn="File editing disallowed."';

		// archived="N" surfaces last turn's 413 archive count next to budget numbers.
		let archivedAttr = "";
		const priorTurn = ctx.turn - 1;
		if (priorTurn >= 1) {
			const prior = rows.find((r) => {
				if (!r.path.startsWith(`log://turn_${priorTurn}/error/`)) return false;
				const attrs =
					typeof r.attributes === "string"
						? JSON.parse(r.attributes)
						: r.attributes;
				return attrs?.status === 413 && attrs?.archivedCount > 0;
			});
			if (prior) {
				const attrs =
					typeof prior.attributes === "string"
						? JSON.parse(prior.attributes)
						: prior.attributes;
				archivedAttr = ` archived="${attrs.archivedCount}"`;
			}
		}

		// <prompt> wrapper carries section-level metadata (commands, mode
		// warn, reverted-from-413). The body is heredoc-fenced so any
		// task description containing tag-shaped text won't be parsed as
		// a tool call when the model echoes attention through the packet.
		const meta = {};
		if (promptEntry?.aTokens != null) meta.tokens = promptEntry.aTokens;
		if (promptEntry?.vLines != null) meta.lines = promptEntry.vLines;
		const fenced = promptEntry ? renderEntry(promptEntry.path, meta, body) : "";
		return `${content}<prompt commands="${commands}"${warn}${archivedAttr}>\n${fenced}\n</prompt>`;
	}
}

export default class Prompt {
	#core;

	constructor(core) {
		this.#core = core;
		core.on("turn.started", this.onTurnStarted.bind(this));
		core.filter("assembly.user", this.assemblePrompt.bind(this), 300);
	}

	async onTurnStarted({ rummy, mode, prompt, isContinuation }) {
		const { entries: store, sequence: turn, runId } = rummy;

		if (!isContinuation && prompt) {
			await store.upsert(runId, turn, `prompt://${turn}`, "", "info", {
				attributes: { mode },
			});
			await store.upsert(runId, turn, `${mode}://${turn}`, prompt, "info");
		} else {
			await store.upsert(
				runId,
				turn,
				`progress://${turn}`,
				prompt || "",
				"info",
			);
		}
	}

	async assemblePrompt(content, ctx) {
		const promptEntry = ctx.rows.findLast(
			(r) =>
				r.category === "prompt" && (r.scheme === "ask" || r.scheme === "act"),
		);

		const mode = promptEntry?.scheme || ctx.type;
		const body = promptEntry?.body || "";
		const tools = this.#core.hooks.tools.namesForMode(mode).join(", ");
		const warn =
			mode === "ask"
				? ' warn="File and system modification prohibited on this turn."'
				: "";

		return `${content}<${mode} tools="${tools}"${warn}>${body}</${mode}>`;
	}
}

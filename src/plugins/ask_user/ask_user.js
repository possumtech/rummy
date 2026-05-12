import docs from "./ask_userDoc.js";

const LOG_ACTION_RE = /^log:\/\/\d+\/\d+\/\d+\/(\w+)$/;

export default class AskUser {
	#core;

	constructor(core) {
		this.#core = core;
		core.registerScheme();
		core.on("handler", this.handler.bind(this));
		core.on("view", this.full.bind(this));
		core.filter("instructions.toolDocs", async (docsMap) => {
			docsMap.ask_user = docs;
			return docsMap;
		});
		core.on("proposal.accepted", this.#onResolved.bind(this));
		core.on("proposal.rejected", this.#onResolved.bind(this));
	}

	async #onResolved(ctx) {
		const m = LOG_ACTION_RE.exec(ctx.path);
		if (m?.[1] !== "ask_user") return;
		if (!ctx.output) return;
		await ctx.entries.set({
			runId: ctx.runId,
			loopId: ctx.loopId,
			turn: ctx.turn,
			path: ctx.path,
			attributes: { ...ctx.attrs, answer: ctx.output },
		});
	}

	async handler(entry, rummy) {
		const { entries: store, sequence: turn, runId, loopId } = rummy;
		const { question, options: rawOptions } = entry.attributes;

		let options = [];
		if (rawOptions) {
			const delimiter = rawOptions.includes(";") ? ";" : ",";
			options = rawOptions
				.split(delimiter)
				.map((o) => o.trim())
				.filter(Boolean);
		}

		await store.set({
			runId,
			turn,
			path: entry.resultPath,
			body: "",
			state: "proposed",
			attributes: { question, options },
			loopId,
		});
	}

	full(entry) {
		return entry.body;
	}
}

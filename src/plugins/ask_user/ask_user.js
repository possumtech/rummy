import {
	projectEmission,
	SUMMARY_MAX_CHARS,
	summarizeEmission,
} from "../helpers.js";
import docs from "./ask_userDoc.js";

// Per-side cap so summary preserves the arrow separator on long Q/A.
const ARROW = " → ";
const HALF = Math.floor((SUMMARY_MAX_CHARS - ARROW.length) / 2);

const LOG_ACTION_RE = /^log:\/\/turn_\d+\/(\w+)\//;

export default class AskUser {
	#core;

	constructor(core) {
		this.#core = core;
		core.registerScheme();
		core.on("handler", this.handler.bind(this));
		core.on("visible", this.full.bind(this));
		core.on("summarized", this.summary.bind(this));
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
		const turn = (await ctx.db.get_run_by_id.get({ id: ctx.runId })).next_turn;
		await ctx.entries.set({
			runId: ctx.runId,
			turn,
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
			body: entry.attributes.source,
			state: "proposed",
			attributes: { question, options },
			loopId,
		});
	}

	full(entry) {
		// Append `<answer>` once resolved so the model sees the full Q&A.
		const { answer } = entry.attributes;
		const body = answer
			? `${entry.body}\n<answer>${answer}</answer>`
			: entry.body;
		return projectEmission(body);
	}

	summary(entry) {
		const { question, answer } = entry.attributes;
		const text = answer
			? `${question.slice(0, HALF)}${ARROW}${answer.slice(0, HALF)}`
			: question.slice(0, SUMMARY_MAX_CHARS);
		return summarizeEmission(text);
	}
}

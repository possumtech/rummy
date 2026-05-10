import {
	logPathToDataBase,
	projectEmission,
	streamSummary,
} from "../helpers.js";
import docs from "./shDoc.js";

const LOG_ACTION_RE = /^log:\/\/turn_\d+\/(\w+)\//;

export default class Sh {
	#core;

	constructor(core) {
		this.#core = core;
		// sh:// stream entries are catalog data (live in <index>, sorted to
		// bottom as volatile). Action recap log entries (scheme="log") are
		// unaffected — they're owned by the log scheme and render in <log>.
		core.registerScheme({ category: "data", volatile: true });
		core.on("handler", this.handler.bind(this));
		core.on("view", this.full.bind(this));
		core.filter("instructions.toolDocs", async (docsMap) => {
			docsMap.sh = docs;
			return docsMap;
		});
		core.on("proposal.accepted", this.#onAccepted.bind(this));
	}

	async #onAccepted(ctx) {
		const m = LOG_ACTION_RE.exec(ctx.path);
		if (m?.[1] !== "sh") return;
		let command = "";
		if (ctx.attrs?.command) command = ctx.attrs.command;
		else if (ctx.attrs?.tags) command = ctx.attrs.tags;
		const turn = (await ctx.db.get_run_by_id.get({ id: ctx.runId })).next_turn;
		const dataBase = logPathToDataBase(ctx.path);
		for (const ch of [1, 2]) {
			await ctx.entries.set({
				runId: ctx.runId,
				turn,
				path: `${dataBase}_${ch}`,
				body: "",
				state: "streaming",
				visibility: "indexed",
				attributes: { command, tags: command, channel: ch },
			});
		}
		await ctx.entries.set({
			runId: ctx.runId,
			path: ctx.path,
			state: "resolved",
		});
	}

	async handler(entry, rummy) {
		const { entries: store, sequence: turn, runId, loopId } = rummy;
		await store.set({
			runId,
			turn,
			path: entry.resultPath,
			body: "",
			state: "proposed",
			attributes: { ...entry.attributes, tags: entry.attributes.command },
			loopId,
		});
	}

	// log:// entries: emission, tab-indented. sh:// entries: tail stream
	// (last 20 lines, capped at SUMMARY_MAX_CHARS) so giants don't blow
	// the budget — full bytes available in the row's stored body.
	full(entry) {
		if (entry.path.startsWith("log://")) return projectEmission(entry.body);
		return streamSummary("sh", entry);
	}
}

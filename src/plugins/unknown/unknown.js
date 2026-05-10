import { renderEntry } from "../helpers.js";

export default class Unknown {
	constructor(core) {
		core.ensureTool();
		core.registerScheme({
			category: "unknown",
		});
		core.on("handler", this.handler.bind(this));
		// No view registered: default summarizeEmission (≤500-char tile).
		core.filter("assembly.system", this.assembleUnknowns.bind(this), 350);
		// Written via <set path="unknown://...">; lifecycle in instructions-user.md.
		core.markHidden();
	}

	async handler(entry, rummy) {
		const { entries: store, sequence: turn, runId, loopId } = rummy;

		const existingValues = await store.getUnknownValues(runId);
		if (existingValues.has(entry.body)) {
			await store.set({
				runId,
				turn,
				loopId,
				path: entry.resultPath || entry.path,
				body: `Unknown deduped: "${entry.body.slice(0, 60)}"`,
				state: "failed",
				outcome: "duplicate",
			});
			return;
		}

		const unknownPath = await store.slugPath(
			runId,
			"unknown",
			entry.body,
			entry.attributes?.tags,
		);
		await store.set({
			runId,
			turn,
			path: unknownPath,
			body: entry.body,
			state: "resolved",
			loopId,
		});
	}

	async assembleUnknowns(content, ctx) {
		const entries = ctx.rows.filter(
			(r) => r.category === "unknown" && r.visibility === "indexed",
		);
		if (entries.length === 0) return content;
		const lines = entries.map((e) => renderUnknownTag(e));
		return `${content}<unknowns>\n${lines.join("\n")}\n</unknowns>\n`;
	}
}

function renderUnknownTag(entry) {
	const attrs =
		typeof entry.attributes === "string"
			? JSON.parse(entry.attributes)
			: entry.attributes;
	const meta = {};
	if (entry.source_turn) meta.turn = entry.source_turn;
	if (typeof attrs?.tags === "string") {
		meta.tags = attrs.tags.slice(0, 80);
	}
	if (entry.aTokens != null) meta.tokens = entry.aTokens;
	return renderEntry(entry.path, meta, entry.body);
}

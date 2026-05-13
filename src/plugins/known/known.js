import { stateToStatus } from "../../agent/httpStatus.js";
import { renderEntry } from "../helpers.js";

export default class Known {
	#core;

	constructor(core) {
		this.#core = core;
		core.ensureTool();
		core.registerScheme({ category: "data" });
		core.on("handler", this.handler.bind(this));
		// Full-body tile: knowns are model-authored short content; the
		// body is the tile.
		core.on("view", (entry) => entry.body);
		core.filter("assembly.system", this.assembleIndex.bind(this), 200);
		// Written via <set path="known://...">; lifecycle in instructions-user.md.
		core.markHidden();
	}

	async handler(entry, rummy) {
		const { entries: store, sequence: turn, runId, loopId } = rummy;
		if (!entry.body) return;

		let knownPath = entry.attributes?.path;
		if (knownPath && !knownPath.includes("://")) {
			knownPath = `known://${knownPath}`;
		}
		if (!knownPath) {
			knownPath = await store.slugPath(
				runId,
				"known",
				entry.body,
				entry.attributes?.tags,
			);
		}

		// Dedup: existing path → update; empty body preserves existing body.
		const existing = await store.getEntriesByPattern(runId, knownPath, null);
		if (existing.length > 0) {
			const nextBody = entry.body === "" ? existing[0].body : entry.body;
			await store.set({
				runId,
				turn,
				path: existing[0].path,
				body: nextBody,
				state: "resolved",
				attributes: entry.attributes,
				loopId,
			});
			return;
		}

		await store.set({
			runId,
			turn,
			path: knownPath,
			body: entry.body,
			state: "resolved",
			attributes: entry.attributes,
			loopId,
		});
	}

	// <index> assembles every indexed catalog row (category=data) in a
	// single section. v_model_context returns rows already sorted: stable
	// schemes first, volatile last.
	async assembleIndex(content, ctx) {
		const entries = ctx.rows.filter(
			(r) => r.category === "data" && r.visibility === "indexed",
		);
		if (entries.length === 0) return content;
		const lines = entries.map((e) =>
			renderContextTag(
				e,
				e.vBody != null ? e.vBody : e.body,
				ctx.expectedTokensFree,
			),
		);
		return `${content}<index>\n${lines.join("\n")}\n</index>\n`;
	}
}

function renderContextTag(entry, projectedBody, expectedTokensFree = null) {
	const attrs =
		typeof entry.attributes === "string"
			? JSON.parse(entry.attributes)
			: entry.attributes;
	const statusValue =
		attrs?.status != null
			? attrs.status
			: entry.state
				? stateToStatus(entry.state, entry.outcome)
				: null;
	const meta = {};
	if (entry.source_turn) meta.turn = entry.source_turn;
	if (statusValue != null && statusValue !== 200) meta.status = statusValue;
	if (entry.state && entry.state !== "resolved") meta.state = entry.state;
	if (entry.outcome) meta.outcome = entry.outcome;
	if (typeof attrs?.tags === "string") {
		meta.tags = attrs.tags.slice(0, 80);
	}
	// Meta `tokens`/`lines` = full body size (what <get> would cost).
	// The tile's projected body might be smaller (symbols only, partial,
	// or empty). Budget accounting uses aTokens directly via <turn>.
	if (entry.bodyTokens != null) meta.tokens = entry.bodyTokens;
	else if (entry.aTokens != null) meta.tokens = entry.aTokens;
	if (entry.bodyLines != null) meta.lines = entry.bodyLines;
	else if (entry.vLines != null) meta.lines = entry.vLines;
	// mimetype on every index tile (SPEC #mimetype). Default
	// `text/markdown` applies when unset — the model never has to guess.
	meta.mimetype = attrs?.mimetype ?? "text/markdown";
	// `overflow: true` when fetching this entry's full body would
	// exceed available budget. Model uses it to gate `<get>` decisions
	// without recomputing `tokens > tokensFree` mentally. Omitted when
	// false (the absence is the negative case — keeps envelopes terse).
	if (
		expectedTokensFree != null &&
		meta.tokens != null &&
		meta.tokens > expectedTokensFree
	) {
		meta.overflow = true;
	}
	return renderEntry(entry.path, meta, projectedBody);
}

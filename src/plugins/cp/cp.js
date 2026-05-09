import Entries from "../../agent/Entries.js";
import { countTokens } from "../../agent/tokens.js";
import { projectEmission, storePatternResult } from "../helpers.js";
import docs from "./cpDoc.js";

export default class Cp {
	#core;

	constructor(core) {
		this.#core = core;
		core.registerScheme();
		core.on("handler", this.handler.bind(this));
		core.on("visible", this.full.bind(this));
		core.on("summarized", this.summary.bind(this));
		core.filter("instructions.toolDocs", async (docsMap) => {
			docsMap.cp = docs;
			return docsMap;
		});
	}

	async handler(entry, rummy) {
		const { entries: store, sequence: turn, runId, loopId } = rummy;
		const { path, to } = entry.attributes;
		const VALID = { visible: 1, summarized: 1, archived: 1 };
		const visibility = VALID[entry.attributes.visibility]
			? entry.attributes.visibility
			: undefined;

		// Manifest: list what would be copied without performing the cp.
		if (entry.attributes.manifest !== undefined) {
			const matches = await store.getEntriesByPattern(runId, path);
			await storePatternResult(store, runId, turn, "cp", path, null, matches, {
				manifest: true,
				loopId,
				attributes: { path, to },
			});
			return;
		}

		const source = await store.getBody(runId, path);
		if (source === null) return;
		// Tags propagate: explicit `tags=` on the cp wins; otherwise the
		// destination inherits the source entry's tags. Same shape as
		// visibility — explicit attr overrides, default inherits.
		let destTags = null;
		if (typeof entry.attributes.tags === "string") {
			destTags = entry.attributes.tags;
		} else {
			const sourceAttrs = await store.getAttributes(runId, path);
			if (sourceAttrs && typeof sourceAttrs.tags === "string") {
				destTags = sourceAttrs.tags;
			}
		}

		const destScheme = Entries.scheme(to);
		const existing = await store.getBody(runId, to);
		const warning =
			existing !== null ? `Overwrote existing entry at ${to}` : null;

		// Token impact across the affected paths: before = source +
		// existing-dest (if any); after = source + source (the copy
		// duplicates the body at the destination).
		const sourceTokens = countTokens(source);
		const destOldTokens = existing !== null ? countTokens(existing) : 0;
		const beforeTokens = sourceTokens + destOldTokens;
		const afterTokens = sourceTokens * 2;

		if (destScheme === null) {
			// Bare-file destination: hand the shared materializer (set.js
			// #materializeFile, gated on attrs.path + attrs.patched) the
			// authoritative new body so it writes the source content to
			// disk on accept. Without this the proposal accepted but no
			// file landed — the model's "<cp src dest> then <set dest>
			// SEARCH/REPLACE" sequence silently no-op'd at materialize.
			await store.set({
				runId,
				turn,
				path: entry.resultPath,
				body: entry.attributes.source,
				state: "proposed",
				attributes: {
					from: path,
					to,
					isMove: false,
					warning,
					path: to,
					patched: source,
					visibility,
					beforeActionTokens: beforeTokens,
					afterActionTokens: afterTokens,
				},
				loopId,
			});
		} else {
			await store.set({
				runId,
				turn,
				path: to,
				body: source,
				state: "resolved",
				visibility,
				attributes: destTags ? { tags: destTags } : null,
				loopId,
			});
			await store.set({
				runId,
				turn,
				path: entry.resultPath,
				body: entry.attributes.source,
				state: "resolved",
				attributes: {
					from: path,
					to,
					isMove: false,
					warning,
					beforeActionTokens: beforeTokens,
					afterActionTokens: afterTokens,
				},
				loopId,
			});
		}
	}

	full(entry) {
		return projectEmission(entry.body);
	}

	summary() {
		return "";
	}
}

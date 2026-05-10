import Entries from "../../agent/Entries.js";
import { countTokens } from "../../agent/tokens.js";
import { projectEmission, storePatternResult } from "../helpers.js";
import docs from "./cpDoc.js";

function visibilityFromAttrs(attrs) {
	const wantArchive = attrs.archive !== undefined;
	const wantIndex = attrs.index !== undefined;
	if (wantArchive && wantIndex) return "conflict";
	if (wantArchive) return "archived";
	if (wantIndex) return "indexed";
	return undefined;
}

export default class Cp {
	#core;

	constructor(core) {
		this.#core = core;
		core.registerScheme();
		core.on("handler", this.handler.bind(this));
		core.on("view", this.full.bind(this));
		core.filter("instructions.toolDocs", async (docsMap) => {
			docsMap.cp = docs;
			return docsMap;
		});
	}

	async handler(entry, rummy) {
		const { entries: store, sequence: turn, runId, loopId } = rummy;
		const { path, to } = entry.attributes;
		const visibilityAttr = visibilityFromAttrs(entry.attributes);
		if (visibilityAttr === "conflict") {
			await store.set({
				runId,
				turn,
				loopId,
				path: entry.resultPath,
				body: "Cannot specify both archive and index on the same <cp>.",
				state: "failed",
				outcome: "validation",
				attributes: { path, to },
			});
			return;
		}
		const visibility = visibilityAttr;

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
		// Tags: explicit attr wins; otherwise destination inherits source's.
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

		const sourceTokens = countTokens(source);
		const destOldTokens = existing !== null ? countTokens(existing) : 0;
		const beforeTokens = sourceTokens + destOldTokens;
		const afterTokens = sourceTokens * 2;

		if (destScheme === null) {
			// Bare-file: hand the shared set.js materializer attrs.patched.
			await store.set({
				runId,
				turn,
				path: entry.resultPath,
				body: "",
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
				body: "",
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
}

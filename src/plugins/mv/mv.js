import Entries from "../../agent/Entries.js";
import { countTokens } from "../../agent/tokens.js";
import {
	projectEmission,
	storePatternResult,
	summarizeEmission,
} from "../helpers.js";
import docs from "./mvDoc.js";

const LOG_ACTION_RE = /^log:\/\/turn_\d+\/(\w+)\//;

export default class Mv {
	#core;

	constructor(core) {
		this.#core = core;
		core.registerScheme();
		core.on("handler", this.handler.bind(this));
		core.on("visible", this.full.bind(this));
		core.on("summarized", this.summary.bind(this));
		core.filter("instructions.toolDocs", async (docsMap) => {
			docsMap.mv = docs;
			return docsMap;
		});
		core.on("proposal.accepted", this.#onAccepted.bind(this));
	}

	async #onAccepted(ctx) {
		const m = LOG_ACTION_RE.exec(ctx.path);
		if (m?.[1] !== "mv") return;
		if (!ctx.attrs?.isMove || !ctx.attrs?.from) return;
		await ctx.entries.rm({ runId: ctx.runId, path: ctx.attrs.from });
	}

	async handler(entry, rummy) {
		const { entries: store, sequence: turn, runId, loopId } = rummy;
		const { path, to } = entry.attributes;
		const VALID = { visible: 1, summarized: 1, archived: 1 };
		const visibility = VALID[entry.attributes.visibility]
			? entry.attributes.visibility
			: undefined;

		if (entry.attributes.manifest !== undefined) {
			const matches = await store.getEntriesByPattern(runId, path);
			await storePatternResult(store, runId, turn, "mv", path, null, matches, {
				manifest: true,
				loopId,
				attributes: { path, to },
			});
			return;
		}

		// Visibility-in-place: no destination, change visibility of matches.
		if (visibility && !to) {
			const matches = await store.getEntriesByPattern(runId, path);
			for (const match of matches)
				await store.set({
					runId: runId,
					path: match.path,
					visibility: visibility,
				});
			const label = `set to ${visibility}`;
			await store.set({
				runId,
				turn,
				path: entry.resultPath,
				body: `${matches.map((m) => m.path).join(", ")} ${label}`,
				state: "resolved",
				visibility: "archived",
				loopId,
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
			existing !== null && destScheme !== null
				? `Overwrote existing entry at ${to}`
				: null;

		const sourceTokens = countTokens(source);
		const destOldTokens = existing !== null ? countTokens(existing) : 0;
		const beforeTokens = sourceTokens + destOldTokens;
		const afterTokens = sourceTokens;

		if (destScheme === null) {
			// Bare-file: hand the shared set.js materializer attrs.patched.
			await store.set({
				runId,
				turn,
				path: entry.resultPath,
				body: entry.attributes.source,
				state: "proposed",
				attributes: {
					from: path,
					to,
					isMove: true,
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
			await store.rm({ runId: runId, path: path });
			await store.set({
				runId,
				turn,
				path: entry.resultPath,
				body: entry.attributes.source,
				state: "resolved",
				attributes: {
					from: path,
					to,
					isMove: true,
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

	summary(entry) {
		return summarizeEmission(entry.body);
	}
}

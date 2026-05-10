import Entries from "../../agent/Entries.js";
import { countTokens } from "../../agent/tokens.js";
import { projectEmission, storePatternResult } from "../helpers.js";
import docs from "./getDoc.js";

export default class Get {
	#core;

	constructor(core) {
		this.#core = core;
		core.registerScheme();
		core.on("handler", this.handler.bind(this));
		core.on("view", this.full.bind(this));
		core.filter("instructions.toolDocs", async (docsMap) => {
			docsMap.get = docs;
			return docsMap;
		});
	}

	async handler(entry, rummy) {
		const { entries: store, sequence: turn, runId, loopId } = rummy;
		const tagsAttr = entry.attributes.tags;
		// Tags-only get defaults path to "**" for tag-only recall.
		const target = entry.attributes.path || (tagsAttr ? "**" : null);
		if (!target) {
			await store.set({
				runId,
				turn,
				loopId,
				path: entry.resultPath,
				body: 'Missing required "path" attribute on <get>. Use <get path="..."/>.',
				state: "failed",
				outcome: "validation",
			});
			return;
		}
		const normalized = Entries.normalizePath(target);
		const bodyFilter = entry.attributes.body;
		const manifest = entry.attributes.manifest !== undefined;
		const wantedTags = tagsAttr
			? tagsAttr
					.split(",")
					.map((t) => t.trim().toLowerCase())
					.filter(Boolean)
			: null;
		const isPattern = bodyFilter || normalized.includes("*") || !!wantedTags;

		// Negative line = tail-from-end (line=-50 starts 50 from end).
		const lineRaw = entry.attributes.line;
		const line = lineRaw != null ? parseInt(lineRaw, 10) : null;
		const limit =
			entry.attributes.limit != null
				? Math.max(1, parseInt(entry.attributes.limit, 10))
				: null;

		let matches = await store.getEntriesByPattern(
			runId,
			normalized,
			bodyFilter,
		);
		if (wantedTags) {
			matches = matches.filter((e) => {
				if (!e.attributes) return false;
				const attrs =
					typeof e.attributes === "string"
						? JSON.parse(e.attributes)
						: e.attributes;
				if (typeof attrs.tags !== "string") return false;
				const tags = attrs.tags.toLowerCase();
				return wantedTags.every((t) => tags.includes(t));
			});
		}

		if (manifest) {
			await storePatternResult(
				store,
				runId,
				turn,
				"get",
				target,
				bodyFilter,
				matches,
				{ manifest: true, loopId, attributes: { path: target } },
			);
			return;
		}

		// Partial read: slice into attrs.slice, no promotion. Multi-match
		// emits one section per match.
		if (line !== null || limit !== null) {
			if (matches.length === 0) {
				await store.set({
					runId,
					turn,
					path: entry.resultPath,
					body: "",
					state: "resolved",
					outcome: "not_found",
					loopId,
					attributes: {
						path: target,
						line,
						limit,
						error: `${target} not found`,
					},
				});
				return;
			}
			const sections = matches.map((match) => sliceSection(match, line, limit));
			const sliceBody = sections.map((s) => s.text).join("\n\n");
			const attributes = {
				path: target,
				line,
				limit,
				beforeActionTokens: 0,
				afterActionTokens: countTokens(sliceBody),
			};
			if (sections.length === 1) {
				const only = sections[0];
				attributes.lineStart = only.startLine;
				attributes.lineEnd = only.endLine;
				attributes.totalLines = only.total;
			} else {
				attributes.matchCount = sections.length;
			}
			await store.set({
				runId,
				turn,
				path: entry.resultPath,
				body: sliceBody,
				state: "resolved",
				loopId,
				attributes,
			});
			return;
		}

		// <get> greedily re-indexes any matched archived entries (S7).
		// Asymmetric: get can promote archived → indexed, never reverse.
		// Visibility flips between directions are <set archive/> / <set index/>.
		await store.get({
			runId: runId,
			turn: turn,
			path: normalized,
			bodyFilter: bodyFilter,
		});

		if (isPattern) {
			await storePatternResult(
				store,
				runId,
				turn,
				"get",
				target,
				bodyFilter,
				matches,
				{ loopId, attributes: { path: target } },
			);
		} else if (matches.length === 0) {
			await store.set({
				runId,
				turn,
				path: entry.resultPath,
				body: "",
				state: "resolved",
				outcome: "not_found",
				loopId,
				attributes: { path: target, error: `${target} not found` },
			});
		} else {
			// <get> is the fat-fetch verb: log body = retrieved content
			// (S6). Single match → body is the entry's body. Multi-match
			// (rare in non-pattern path) → concatenated with path headers.
			const body =
				matches.length === 1
					? matches[0].body
					: matches.map((m) => `${m.path}\n${m.body}`).join("\n\n");
			const retrievedTokens = countTokens(body);
			await store.set({
				runId,
				turn,
				path: entry.resultPath,
				body,
				state: "resolved",
				loopId,
				attributes: {
					path: target,
					beforeActionTokens: 0,
					afterActionTokens: retrievedTokens,
				},
			});
		}
	}

	full(entry) {
		return projectEmission(entry.body);
	}
}

function sliceSection(match, line, limit) {
	const allLines = match.body.split("\n");
	const total = allLines.length;
	const startLine =
		line == null
			? 1
			: line < 0
				? Math.max(1, total + line + 1)
				: Math.max(1, line);
	const startIdx = startLine - 1;
	const endIdx = limit !== null ? Math.min(startIdx + limit, total) : total;
	const slice = allLines.slice(startIdx, endIdx).join("\n");
	const text = `${match.path}\n[lines ${startLine}–${endIdx} / ${total} total]\n${slice}`;
	return { text, startLine, endLine: endIdx, total };
}

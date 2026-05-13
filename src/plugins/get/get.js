import Entries from "../../agent/Entries.js";
import { countTokens } from "../../agent/tokens.js";
import { storePatternResult } from "../helpers.js";
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

		// Range bounds vocabulary aligned with SEARCH/REPLACE's scoped form
		// (`<<SEARCH[lineFirst]SEARCH[lineFinal]…`) and the numbered-lines
		// projection. Negative `lineFirst` = tail-from-end
		// (lineFirst=-50 starts 50 from end). Omitted `lineFinal` reads
		// from `lineFirst` to end of body. XmlParser lowercases attribute
		// keys, so the model writes `lineFirst`/`lineFinal` for readability;
		// the engine reads `linefirst`/`linefinal`.
		const firstRaw = entry.attributes.linefirst;
		const finalRaw = entry.attributes.linefinal;
		const lineFirst = firstRaw != null ? parseInt(firstRaw, 10) : null;
		const lineFinal = finalRaw != null ? parseInt(finalRaw, 10) : null;

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
		// emits one section per match. Single vocabulary: lineFirst /
		// lineFinal / lineTotal — same names the model wrote in its
		// emission. Attrs carry RESOLVED bounds (after clamping /
		// negative-offset resolution); the request itself is preserved
		// in the model's own emission archive (`assistant://N`).
		if (lineFirst !== null || lineFinal !== null) {
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
						lineFirst,
						lineFinal,
						error: `${target} not found`,
					},
				});
				return;
			}
			const sections = matches.map((match) =>
				sliceSection(match, lineFirst, lineFinal),
			);
			const sliceBody = sections.map((s) => s.text).join("\n\n");
			const attributes = {
				path: target,
				beforeActionTokens: 0,
				afterActionTokens: countTokens(sliceBody),
			};
			if (sections.length === 1) {
				const only = sections[0];
				attributes.lineFirst = only.lineFirst;
				attributes.lineFinal = only.lineFinal;
				attributes.lineTotal = only.lineTotal;
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
		// `<get>` is the only action whose log body opts into `N:\t<line>`
		// numbering — line refs are the contract of the retrieval verb.
		// Other entries render their bodies verbatim. `lineStart` mirrors
		// the chunk's `lineFirst` so numbering matches the source's
		// absolute line positions; otherwise chunked reads would lie.
		const lineStart = entry.attributes?.lineFirst ?? 1;
		return { body: entry.body, numbered: true, lineStart };
	}
}

function sliceSection(match, lineFirst, lineFinal) {
	const allLines = match.body.split("\n");
	const lineTotal = allLines.length;
	const resolvedFirst =
		lineFirst == null
			? 1
			: lineFirst < 0
				? Math.max(1, lineTotal + lineFirst + 1)
				: Math.max(1, lineFirst);
	const resolvedFinal =
		lineFinal == null
			? lineTotal
			: lineFinal < 0
				? Math.max(resolvedFirst, lineTotal + lineFinal + 1)
				: Math.min(lineTotal, Math.max(resolvedFirst, lineFinal));
	const startIdx = resolvedFirst - 1;
	const endIdx = resolvedFinal;
	// Body is the slice content only. Range info lives in the JSON
	// envelope (lineFirst/lineFinal/lineTotal attrs). No header in body.
	const text = allLines.slice(startIdx, endIdx).join("\n");
	return { text, lineFirst: resolvedFirst, lineFinal: endIdx, lineTotal };
}

import HeuristicMatcher, {
	generatePatch,
	generateSearchReplaceBody,
} from "./matcher.js";
import { hedmatch, hedsearch } from "./patterns.js";

// SPEC #hedberg. Edit-shape parsing lives in marker.js.
export default class Hedberg {
	#core;

	constructor(core) {
		this.#core = core;

		core.hooks.hedberg = {
			match: hedmatch,
			search: hedsearch,
			replace: Hedberg.replace,
			generatePatch,
			generateSearchReplaceBody,
		};
	}

	// Line-boundary-anchored literal substitution, heuristic fuzzy fallback.
	// `sed=true` strips regex-meta backslashes for muscle-memory escape
	// friendliness; we never actually compile a regex.
	//
	// The match must start at start-of-body or right after a newline AND
	// end at end-of-body or right before a newline — i.e., the searchText
	// must span complete lines. Substring matches inside a line are not
	// honored; the prior naked-`includes/replaceAll` contract was the
	// source of a real corruption (SEARCH `foo` splicing mid-line into
	// `foo (extra)` and dragging the parenthetical onto the replacement).
	// If the model wants to rewrite part of a line, it includes the full
	// line in SEARCH and writes the modified full line in REPLACE.
	static replace(body, search, replacement, { sed = false } = {}) {
		let patch = null;
		let warning = null;
		let error = null;
		let matchStartLine = null;
		let replaceLineCount = 0;
		let searchLineCount = 0;
		const stripRegexEscapes = (s) => s.replace(/\\([[\](){}.*+?^$|\\])/g, "$1");
		const searchText = sed ? stripRegexEscapes(search) : search;
		const replaceText = sed ? stripRegexEscapes(replacement) : replacement;

		const occurrences = lineBoundedOccurrences(body, searchText);
		if (occurrences.length > 0) {
			const out = [];
			let cursor = 0;
			for (const idx of occurrences) {
				out.push(body.slice(cursor, idx));
				out.push(replaceText);
				cursor = idx + searchText.length;
			}
			out.push(body.slice(cursor));
			patch = out.join("");
			if (occurrences.length > 1) {
				warning = `SEARCH matched ${occurrences.length} locations at line boundaries; all were replaced. Include more surrounding context (or a SEARCH[N-M] scope) for surgical edits.`;
			}
			const lastIdx = occurrences[occurrences.length - 1];
			matchStartLine = body.slice(0, lastIdx).split("\n").length;
			replaceLineCount =
				replaceText === "" ? 0 : replaceText.split("\n").length;
			searchLineCount = searchText === "" ? 0 : searchText.split("\n").length;
		}

		if (!patch) {
			const matched = HeuristicMatcher.matchAndPatch(
				"",
				body,
				searchText,
				replaceText,
			);
			patch = matched.newContent;
			warning = matched.warning;
			error = matched.error;
			matchStartLine = matched.matchStartLine ?? null;
			replaceLineCount = matched.replaceLineCount ?? 0;
			searchLineCount = matched.searchLineCount ?? 0;
		}

		return {
			patch,
			searchText,
			replaceText,
			warning,
			error,
			matchStartLine,
			replaceLineCount,
			searchLineCount,
		};
	}
}

export { generatePatch, generateSearchReplaceBody };

// All positions where `needle` occurs in `haystack` such that the
// match starts at a line boundary (start-of-string or after `\n`) AND
// ends at a line boundary (end-of-string or before `\n`).
function lineBoundedOccurrences(haystack, needle) {
	if (!needle) return [];
	const positions = [];
	let from = 0;
	while (true) {
		const idx = haystack.indexOf(needle, from);
		if (idx === -1) return positions;
		const startOK = idx === 0 || haystack[idx - 1] === "\n";
		const endPos = idx + needle.length;
		const endOK = endPos === haystack.length || haystack[endPos] === "\n";
		if (startOK && endOK) positions.push(idx);
		from = idx + 1;
	}
}

import HeuristicMatcher, { generatePatch } from "./matcher.js";
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
		};
	}

	// Literal substitution first, heuristic fuzzy fallback. `sed=true` strips
	// regex-meta backslashes for muscle-memory escape friendliness; we never
	// actually compile a regex.
	static replace(body, search, replacement, { sed = false } = {}) {
		let patch = null;
		let warning = null;
		let error = null;
		const stripRegexEscapes = (s) => s.replace(/\\([[\](){}.*+?^$|\\])/g, "$1");
		const searchText = sed ? stripRegexEscapes(search) : search;
		const replaceText = sed ? stripRegexEscapes(replacement) : replacement;

		if (body.includes(searchText)) {
			patch = body.replaceAll(searchText, replaceText);
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
		}

		return { patch, searchText, replaceText, warning, error };
	}
}

export { generatePatch };

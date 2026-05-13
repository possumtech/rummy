// Hedberg plugin shim. The library lives at `src/lib/hedberg/`; this
// shim's only job is to expose the same surface as `core.hooks.hedberg`
// for external plugins (e.g. rummy.repo's FileScanner) that can't
// reach into rummy/main's internals via direct import.
//
// Internal plugins should import from `src/lib/hedberg/` directly —
// the hook namespace is for plugins shipped in separate packages.

import Hedberg from "../../lib/hedberg/hedberg.js";
import { hedmatch, hedsearch } from "../../lib/hedberg/patterns.js";
import {
	applyModel as applyUdiffberg,
	parseModel as parseUdiffberg,
	renderClient,
	renderModel,
} from "../../lib/hedberg/udiff.js";

export default class HedbergPlugin {
	#core;

	constructor(core) {
		this.#core = core;
		core.hooks.hedberg = {
			match: hedmatch,
			search: hedsearch,
			replace: Hedberg.replace,
			// Edit pipeline exposed for external plugins. Three siblings of
			// one edit — see src/lib/hedberg/udiff.js for the contract.
			renderClient,
			renderModel,
			parseUdiffberg,
			applyUdiffberg,
		};
	}
}

/**
 * Store plugin: scheme registration and view projections only.
 * No model-facing tool — fidelity control is handled by <set> with
 * stored/summary/index/full attributes. The "store" RPC method for
 * file constraints lives in rpc.js.
 */
export default class Store {
	#core;

	constructor(core) {
		this.#core = core;
		core.registerScheme();
		core.on("full", this.full.bind(this));
		core.on("summary", this.summary.bind(this));
	}

	full(entry) {
		return `# store ${entry.attributes?.path || entry.path}`;
	}

	summary(entry) {
		return this.full(entry);
	}
}

export default class HookRegistry {
	#actions = new Map();
	#filters = new Map();
	#debug = process.env.SNORE_DEBUG === "true";

	static #instance;
	static get instance() {
		if (!HookRegistry.#instance) HookRegistry.#instance = new HookRegistry();
		return HookRegistry.#instance;
	}

	addAction(tag, callback, priority = 10) {
		this.#register(this.#actions, tag, callback, priority);
	}

	addFilter(tag, callback, priority = 10) {
		this.#register(this.#filters, tag, callback, priority);
	}

	#register(map, tag, callback, priority) {
		if (!map.has(tag)) map.set(tag, []);
		map.get(tag).push({ callback, priority });
		map.get(tag).sort((a, b) => a.priority - b.priority);
	}

	/**
	 * Returns the number of listeners for a specific tag.
	 * Used for integrity verification.
	 */
	count(tag) {
		const actionCount = (this.#actions.get(tag) || []).length;
		const filterCount = (this.#filters.get(tag) || []).length;
		return actionCount + filterCount;
	}

	async doAction(tag, ...args) {
		const hooks = this.#actions.get(tag) || [];
		if (this.#debug)
			console.log(`[HOOK] Action: ${tag} (${hooks.length} listeners)`);

		for (const hook of hooks) {
			const start = performance.now();
			await hook.callback(...args);
			if (this.#debug) {
				const duration = (performance.now() - start).toFixed(2);
				console.log(
					`  -> ${hook.callback.name || "anonymous"} completed in ${duration}ms`,
				);
			}
		}
	}

	async applyFilters(tag, value, ...args) {
		const hooks = this.#filters.get(tag) || [];
		if (this.#debug)
			console.log(`[HOOK] Filter: ${tag} (${hooks.length} mutators)`);

		let filteredValue = value;
		for (const hook of hooks) {
			const start = performance.now();
			filteredValue = await hook.callback(filteredValue, ...args);
			if (this.#debug) {
				const duration = (performance.now() - start).toFixed(2);
				console.log(
					`  -> ${hook.callback.name || "anonymous"} returned modified value in ${duration}ms`,
				);
			}
		}
		return filteredValue;
	}
}

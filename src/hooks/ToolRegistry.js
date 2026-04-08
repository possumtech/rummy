export default class ToolRegistry {
	#tools = new Map();
	#handlers = new Map();
	#views = new Map();

	ensureTool(scheme) {
		if (this.#tools.has(scheme)) return;
		this.#tools.set(scheme, Object.freeze({ modes: new Set(["ask", "act"]) }));
	}

	// Exception: old register() removed. Plugins use core.on("handler")/core.on("full").
	// The only remaining caller pathway is ensureTool + onHandle + onView.

	get(name) {
		return this.#tools.get(name);
	}

	has(name) {
		return this.#tools.has(name);
	}

	onHandle(scheme, handler, priority = 10) {
		if (!this.#handlers.has(scheme)) this.#handlers.set(scheme, []);
		const list = this.#handlers.get(scheme);
		list.push({ handler, priority });
		list.sort((a, b) => a.priority - b.priority);
	}

	onView(scheme, fn, fidelity = "full") {
		if (!this.#views.has(scheme)) this.#views.set(scheme, new Map());
		this.#views.get(scheme).set(fidelity, fn);
	}

	async view(scheme, entry) {
		const fidelityMap = this.#views.get(scheme);
		if (!fidelityMap) {
			throw new Error(
				`No view registered for scheme '${scheme}'. ` +
					`Every tool must define how its entries appear in the model view.`,
			);
		}

		const fidelity = entry.fidelity || "full";
		const fn = fidelityMap.get(fidelity);
		if (!fn) {
			// No view for this fidelity — fall back on model-authored summary
			const attrs =
				typeof entry.attributes === "string"
					? JSON.parse(entry.attributes)
					: entry.attributes;
			if (typeof attrs?.summary === "string") return attrs.summary.slice(0, 80);
			return "";
		}
		return await fn(entry);
	}

	hasView(scheme) {
		const fidelityMap = this.#views.get(scheme);
		return fidelityMap?.size > 0;
	}

	async dispatch(scheme, entry, rummy) {
		const list = this.#handlers.get(scheme);
		if (!list) return;
		for (const { handler } of list) {
			const result = await handler(entry, rummy);
			if (result === false) break;
		}
	}

	get actTools() {
		return new Set(
			[...this.#tools.entries()]
				.filter(([, def]) => def.category === "act")
				.map(([name]) => name),
		);
	}

	get names() {
		return [...this.#tools.keys()];
	}

	namesForMode(mode) {
		return [...this.#tools.entries()]
			.filter(([, def]) => def.modes.has(mode))
			.map(([name]) => name);
	}

	/**
	 * Compute the active tool set for a loop.
	 * Starts with all tools for the mode, then removes excluded tools.
	 * Returns a Set of tool names.
	 */
	resolveForLoop(mode, { noInteraction = false, noWeb = false } = {}) {
		const names = this.namesForMode(mode);
		const excluded = new Set();
		if (noInteraction) excluded.add("ask_user");
		if (noWeb) excluded.add("search");
		return new Set(names.filter((n) => !excluded.has(n)));
	}

	entries() {
		return this.#tools.entries();
	}
}

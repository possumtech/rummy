export default class Unknown {
	constructor(core) {
		core.ensureTool();
		// Unknowns are catalog data — they appear in <index> alongside knowns
		// and files. No special <unknowns> section.
		core.registerScheme({ category: "data" });
		core.on("handler", this.handler.bind(this));
		// Full-body tile (like known): unknown bodies are short by intent —
		// they're questions the model is tracking.
		core.on("view", (entry) => entry.body);
		// Written via <set path="unknown://...">; lifecycle in instructions-user.md.
		core.markHidden();
	}

	async handler(entry, rummy) {
		const { entries: store, sequence: turn, runId, loopId } = rummy;

		const existingValues = await store.getUnknownValues(runId);
		if (existingValues.has(entry.body)) {
			await store.set({
				runId,
				turn,
				loopId,
				path: entry.resultPath || entry.path,
				body: `Unknown deduped: "${entry.body.slice(0, 60)}"`,
				state: "failed",
				outcome: "duplicate",
			});
			return;
		}

		const unknownPath = await store.slugPath(
			runId,
			"unknown",
			entry.body,
			entry.attributes?.tags,
		);
		await store.set({
			runId,
			turn,
			path: unknownPath,
			body: entry.body,
			state: "resolved",
			loopId,
		});
	}
}

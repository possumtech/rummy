export default class ErrorLog {
	#core;

	constructor(core) {
		this.#core = core;
		core.registerScheme({ category: "logging" });
		core.on("promoted", (entry) => `# error\n${entry.body}`);
		core.on("demoted", (entry) => entry.body);

		const { hooks } = core;
		hooks.error.log.on(async ({ runId, turn, message, loopId }) => {
			const store = core.entries;
			const path = await store.dedup(runId, "error", message, turn);
			await store.upsert(runId, turn, path, message, 422, { loopId });
		});
	}
}

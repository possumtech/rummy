const BOTH = new Set(["ask", "act"]);

export default class EnvPlugin {
	static register(hooks) {
		hooks.tools.register("env", {
			modes: BOTH,
			category: "ask",
			handler: handleEnv,
			project: (entry) => entry.body,
		});
	}
}

async function handleEnv(entry, rummy) {
	const { entries: store, sequence: turn, runId } = rummy;
	await store.upsert(runId, turn, entry.resultPath, entry.body, "pass", {
		attributes: entry.attributes,
	});
}

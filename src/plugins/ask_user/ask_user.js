const BOTH = new Set(["ask", "act"]);

export default class AskUserPlugin {
	static register(hooks) {
		hooks.tools.register("ask_user", {
			modes: BOTH,
			category: "act",
			handler: handleAskUser,
			project: (entry) => entry.body,
		});
	}
}

async function handleAskUser(entry, rummy) {
	const { entries: store, sequence: turn, runId } = rummy;
	await store.upsert(runId, turn, entry.resultPath, entry.body, "proposed", {
		attributes: entry.attributes,
	});
}

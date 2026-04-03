const BOTH = new Set(["ask", "act"]);

export default class KnownPlugin {
	static register(hooks) {
		hooks.tools.register("known", {
			modes: BOTH,
			category: "act",
			handler: handleKnown,
			project: (entry) => `# known ${entry.path}\n${entry.body}`,
		});
	}
}

async function handleKnown(entry, rummy) {
	const { entries: store, sequence: turn, runId } = rummy;
	const attrs = entry.attributes || {};
	const target = attrs.path || entry.resultPath;

	await store.upsert(runId, turn, target, entry.body, "full");
}

const BOTH = new Set(["ask", "act"]);

export default class AskUserPlugin {
	static register(hooks) {
		hooks.tools.register("ask_user", {
			modes: BOTH,
			category: "act",
			handler: handleAskUser,
			project: (entry) => {
				const attrs = entry.attributes || {};
				return `# ask_user ${attrs.question || ""}\n${entry.body}`;
			},
		});
	}
}

async function handleAskUser(entry, rummy) {
	const { entries: store, sequence: turn, runId } = rummy;
	const attrs = entry.attributes || {};

	// Parse comma-separated options into array
	const rawOptions = attrs.options || entry.body || "";
	const options = rawOptions
		? rawOptions
				.split(",")
				.map((o) => o.trim())
				.filter(Boolean)
		: [];

	await store.upsert(runId, turn, entry.resultPath, entry.body, "proposed", {
		attributes: {
			question: attrs.question,
			options,
		},
	});
}

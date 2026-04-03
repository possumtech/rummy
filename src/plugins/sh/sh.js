const ACT_ONLY = new Set(["act"]);

export default class ShPlugin {
	static register(hooks) {
		hooks.tools.register("sh", {
			modes: ACT_ONLY,
			category: "act",
			handler: handleSh,
			project: (entry) => {
				const attrs = entry.attributes || {};
				return `# sh ${attrs.command || ""}\n${entry.body}`;
			},
		});
	}
}

async function handleSh(entry, rummy) {
	const { entries: store, sequence: turn, runId } = rummy;
	await store.upsert(runId, turn, entry.resultPath, entry.body, "proposed", {
		attributes: entry.attributes,
	});
}

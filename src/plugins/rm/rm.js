const BOTH = new Set(["ask", "act"]);

export default class RmPlugin {
	static register(hooks) {
		hooks.tools.register("rm", {
			modes: BOTH,
			category: "act",
			handler: handleRm,
			project: (entry) => {
				const attrs = entry.attributes || {};
				return `# rm ${attrs.path || entry.path}`;
			},
		});
	}
}

async function handleRm(entry, rummy) {
	const { entries: store, sequence: turn, runId } = rummy;
	const attrs = entry.attributes || {};
	const target = attrs.path;
	if (!target) return;

	const matches = await store.getEntriesByPattern(runId, target, attrs.body);

	for (const match of matches) {
		const resultPath = `rm://${match.path}`;
		const body = match.path;
		if (match.scheme === null) {
			await store.upsert(runId, turn, resultPath, body, "proposed", {
				attributes: { path: match.path },
			});
		} else {
			await store.remove(runId, match.path);
			await store.upsert(runId, turn, resultPath, body, "pass", {
				attributes: { path: match.path },
			});
		}
	}
}

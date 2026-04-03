const BOTH = new Set(["ask", "act"]);

export default class AskUserPlugin {
	static register(hooks) {
		hooks.tools.register("ask_user", {
			modes: BOTH,
			category: "act",
			handler: handleAskUser,
			project: (entry) => {
				const attrs = entry.attributes || {};
				const lines = [`# ask_user`];
				if (attrs.question) lines.push(`# Question: ${attrs.question}`);
				if (attrs.answer) lines.push(`# Answer: ${attrs.answer}`);
				return lines.join("\n");
			},
		});
	}
}

async function handleAskUser(entry, rummy) {
	const { entries: store, sequence: turn, runId } = rummy;
	const attrs = entry.attributes || {};

	// Parse options — semicolon-delimited to avoid breaking on commas in text.
	// Fall back to comma if no semicolons present.
	const rawOptions = attrs.options || entry.body || "";
	const delimiter = rawOptions.includes(";") ? ";" : ",";
	const options = rawOptions
		? rawOptions
				.split(delimiter)
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

// Tool doc for <unknown>. Each entry: [text, rationale].
// Text goes to the model. Rationale stays in source.
// Changing ANY line requires reading ALL rationales first.
const LINES = [
	[
		"## <unknown>[specific thing I need to learn]</unknown> - Track open questions",
	],
	[
		'Example: <unknown path="unknown://answer">contents of answer.txt</unknown>',
		"Path form: explicit unknown path for structured tracking.",
	],
	[
		"Example: <unknown>which database adapter is configured</unknown>",
		"Body form: question as body, path auto-generated.",
	],
	[
		"* Investigate with Tool Commands",
		"Unknowns drive action — get, env, search, ask_user.",
	],
	[
		'* When resolved or irrelevant, remove with <set path="unknown://..." fidelity="archive"/>',
		"Archive instead of delete — preserves the question for context history.",
	],
];

export default LINES.map(([text]) => text).join("\n");

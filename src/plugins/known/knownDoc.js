// Tool doc for <known/>. Each entry: [text, rationale].
// Text goes to the model. Rationale stays in source.
// Changing ANY line requires reading ALL rationales first.
const LINES = [
	[
		'## <known path="known://topic/subtopic" summary="keyword,keyword,keyword">[specific facts, decisions, or plans]</known> - Sort and save what you learn for later recall',
	],
	[
		'Example: <known path="known://people/rumsfeld" summary="defense,secretary,born,1932">Donald Rumsfeld was born in 1932 and served as Secretary of Defense</known>',
		"Explicit path form: slashed path=category/key, summary=keywords.",
	],
	[
		'* Recall with <get path="known://people/*">keyword</get>',
		"Cross-tool lifecycle: pattern by category, filter by keyword.",
	],
];

export default LINES.map(([text]) => text).join("\n");

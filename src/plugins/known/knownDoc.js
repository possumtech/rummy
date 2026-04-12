// Tool doc for <known/>. Each entry: [text, rationale].
// Text goes to the model. Rationale stays in source.
// Changing ANY line requires reading ALL rationales first.
const LINES = [
	// --- Syntax: path = slash-separated topic hierarchy, body = the information to save
	[
		'## <known path="known://topic/subtopic" summary="keyword,keyword,keyword">[specific facts, decisions, or plans]</known> - Sort and save what you learn for later recall',
	],
	// --- Examples: summary-first (simplest), then explicit path (full control)
	[
		'Example: <known summary="hedberg,comedian,death,2005">Mitch Hedberg died on March 30, 2005</known>',
		"Primary pattern: comma-separated keywords in summary. Path auto-generated from summary. Keywords become searchable path segments.",
	],
	[
		'Example: <known path="known://people/rumsfeld" summary="defense,secretary,born,1932">Donald Rumsfeld was born in 1932 and served as Secretary of Defense</known>',
		"Explicit path form: slashed path=category/key, summary=keywords. For when the model wants direct control over taxonomy.",
	],
	// --- Lifecycle
	[
		'* Recall with <get path="known://people/*">keyword</get>',
		"Cross-tool lifecycle: glob by category, filter by keyword. Matches the slashed path convention.",
	],
	[
		"* `summary` keywords survive compression — write keywords you'll search for later",
		"Teaches WHY summaries matter. Keywords become the path AND the compressed view.",
	],
	[
		"* YOU MUST sort and save all new facts, decisions, and plans in their own <known> entries",
		"Critical behavioral constraint. 'new' prevents re-saving known facts.",
	],
];

export default LINES.map(([text]) => text).join("\n");

// Tool doc for <known>. Each entry: [text, rationale].
// Text goes to the model. Rationale stays in source.
// Changing ANY line requires reading ALL rationales first.
const LINES = [
	// --- Syntax: body = the information to save
	["## <known>[information]</known> - Save what you learn for later recall"],

	// --- Examples: taxonomic form first (teaches path + summary), then simple
	[
		'Example: <known path="known://rumsfeld" summary="US Secretary of Defense, born 1932">Donald Rumsfeld was born in 1932 and served as Secretary of Defense</known>',
		"Taxonomic form: path=key, summary=keywords, body=detail. Survives crunching with searchable keywords intact.",
	],
	[
		"Example: <known>Mitch Hedberg died on March 30, 2005</known>",
		"Simple form: auto-slugged path. Works but unsearchable URIs.",
	],

	// --- Lifecycle
	[
		'* Recall with <get path="known://*">keyword</get>',
		"Cross-tool lifecycle: known entries are recalled via get with body filter.",
	],
	[
		'* Archive with <set path="known://..." stored/>',
		"Cross-tool lifecycle: full entries archived to storage when context is tight.",
	],
	[
		"* Entries are your memory — you forget everything not saved as known entries",
		"Critical behavioral constraint. Without this, models assume they'll remember across turns.",
	],
];

export default LINES.map(([text]) => text).join("\n");

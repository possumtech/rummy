// Tool doc for <mv>. Each entry: [text, rationale].
// Text goes to the model. Rationale stays in source.
// Changing ANY line requires reading ALL rationales first.
const LINES = [
	// --- Syntax: path attr = source, body = destination
	[
		'## <mv path="[source]">[destination]</mv> - Move or rename a file or entry',
	],

	// --- Examples: entry rename and file move
	[
		'Example: <mv path="known://active_task">known://completed_task</mv>',
		"Entry rename. Most common mv use case. Shows known:// path convention.",
	],
	[
		'Example: <mv path="src/old_name.js">src/new_name.js</mv>',
		"File rename. Shows that mv works on files too, not just known entries.",
	],

	// --- Constraints
	[
		"* Source path accepts globs for batch moves",
		"Pattern support consistent with get/cp/rm.",
	],
	[
		"* In ask mode, destination MUST be a scheme path (not a file)",
		"Mode constraint. Prevents file mutations in ask mode via mv.",
	],
];

export default LINES.map(([text]) => text).join("\n");

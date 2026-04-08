// Tool doc for <env>. Each entry: [text, rationale].
// Text goes to the model. Rationale stays in source.
// Changing ANY line requires reading ALL rationales first.
const LINES = [
	// --- Syntax
	["## <env>[command]</env> - Run an exploratory shell command"],

	// --- Examples: version check and git status — safe, read-only commands
	[
		"Example: <env>npm --version</env>",
		"Version check. Safe, no side effects.",
	],
	[
		"Example: <env>git log --oneline -5</env>",
		"Git history. Shows env for read-only investigation.",
	],

	// --- Constraints: hard boundaries
	[
		'* YOU MUST NOT use <env/> to read or list files — use <get path="*" preview/> instead',
		"Prevents cat/ls through shell. Forces file access through get for proper tracking.",
	],
	[
		"* YOU MUST use <sh/> for commands with side effects",
		"Separates exploration from action. env = observe, sh = mutate.",
	],
];

export default LINES.map(([text]) => text).join("\n");

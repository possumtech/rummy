// Tool doc for <sh>. Each entry: [text, rationale].
// Text goes to the model. Rationale stays in source.
// Changing ANY line requires reading ALL rationales first.
const LINES = [
	// --- Syntax
	["## <sh>[command]</sh> - Run a shell command with side effects"],

	// --- Examples: install and test — real mutations
	[
		"Example: <sh>npm install express</sh>",
		"Package install. Shows a real side-effect command.",
	],
	[
		"Example: <sh>npm test</sh>",
		"Test execution. Another common side-effect action.",
	],

	// --- Constraints
	[
		"* YOU MUST NOT use <sh/> to read, create, or edit files — use <get/> and <set/>",
		"Forces file operations through the entry system. Prevents untracked mutations.",
	],
	[
		"* YOU MUST use <env/> for commands without side effects",
		"Reinforces the env/sh split. Read = env, mutate = sh.",
	],
];

export default LINES.map(([text]) => text).join("\n");

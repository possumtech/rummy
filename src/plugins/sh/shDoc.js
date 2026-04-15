// Tool doc for <sh>. Each entry: [text, rationale].
// Text goes to the model. Rationale stays in source.
// Changing ANY line requires reading ALL rationales first.
const LINES = [
	["## <sh>[command]</sh> - Run a shell command with side effects"],
	[
		"Example: <sh>npm install express</sh>",
		"Package install. Real side-effect command.",
	],
	[
		"Example: <sh>npm test</sh>",
		"Test execution. Another common side-effect action.",
	],
	[
		"* YOU MUST NOT use <sh></sh> to read, create, or edit files — use <get></get> and <set></set>",
		"Forces file operations through the entry system.",
	],
	[
		"* YOU MUST use <env></env> for commands without side effects",
		"Reinforces the env/sh split. Read = env, mutate = sh.",
	],
];

export default LINES.map(([text]) => text).join("\n");

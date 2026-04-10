// Tool doc for <summarize>. Each entry: [text, rationale].
// Text goes to the model. Rationale stays in source.
// Changing ANY line requires reading ALL rationales first.
const LINES = [
	// --- Syntax
	["## <summarize>[answer or summary]</summarize> - Signal completion"],

	// --- Examples: answer and task completion
	[
		"Example: <summarize>The port is 8080</summarize>",
		"Direct answer. Shows summarize as the vehicle for delivering answers.",
	],
	[
		"Example: <summarize>Installed express, updated config</summarize>",
		"Task summary. Shows summarize for action completion.",
	],

	// --- Constraints: RFC-style MUST/MUST NOT
	[
		"* YOU MUST use <summarize> when done — describes the final state",
		"Completion signal. Without this, the loop continues indefinitely.",
	],
	[
		"* YOU MUST NOT use <summarize> if still working — use <update/> instead",
		"Mutual exclusion with update. Prevents premature completion.",
	],
	[
		"* YOU MUST keep <summarize> to <= 80 characters",
		"Length cap. Matches the summary attribute constraint. Prevents verbose output.",
	],
];

export default LINES.map(([text]) => text).join("\n");

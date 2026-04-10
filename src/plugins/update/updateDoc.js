// Tool doc for <update>. Each entry: [text, rationale].
// Text goes to the model. Rationale stays in source.
// Changing ANY line requires reading ALL rationales first.
const LINES = [
	// --- Syntax
	["## <update>[brief status]</update> - Signal continuation"],

	// --- Examples: research progress and multi-step work
	[
		"Example: <update>Reading config files</update>",
		"Progress checkpoint. Shows update as a status signal, not a log entry.",
	],
	[
		"Example: <update>Found 3 issues, fixing first</update>",
		"Multi-step progress. Shows update for ongoing work.",
	],

	// --- Constraints: RFC-style MUST/MUST NOT
	[
		"* YOU MUST use <update> if still working — describes the current state",
		"Continuation signal. Triggers the next turn in the loop.",
	],
	[
		"* YOU MUST NOT use <update> if done — use <summarize/> instead",
		"Mutual exclusion with summarize. Prevents infinite loops.",
	],
	[
		"* YOU MUST keep <update> to <= 80 characters",
		"Length cap. Prevents models from writing essays in status updates.",
	],
];

export default LINES.map(([text]) => text).join("\n");

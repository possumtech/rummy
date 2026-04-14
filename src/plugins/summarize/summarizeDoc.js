// Tool doc for <summarize>. Each entry: [text, rationale].
// Text goes to the model. Rationale stays in source.
// Changing ANY line requires reading ALL rationales first.
const LINES = [
	["## <summarize>[answer or summary]</summarize> - Signal completion"],
	[
		"Example: <summarize>The port is 8080</summarize>",
		"Direct answer. Summarize delivers answers.",
	],
	[
		"* Required: YOU MUST emit <summarize></summarize> alone. Never include it with other tools.",
		"Forces summarize onto its own turn — prevents the get+summarize race where the model fabricates an answer before retrieval lands.",
	],
	["* YOU MUST keep <summarize> to <= 80 characters", "Length cap."],
];

export default LINES.map(([text]) => text).join("\n");

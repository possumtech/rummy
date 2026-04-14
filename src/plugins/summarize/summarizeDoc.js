// Tool doc for <summarize>. Each entry: [text, rationale].
// Text goes to the model. Rationale stays in source.
// Changing ANY line requires reading ALL rationales first.
const LINES = [
	["## <summarize>[answer or summary]</summarize> - Signal completion"],
	[
		"Example: <summarize>The port is 8080</summarize>",
		"Direct answer. Summarize delivers answers.",
	],
	["* YOU MUST keep <summarize> to <= 80 characters", "Length cap."],
];

export default LINES.map(([text]) => text).join("\n");

// Tool doc for <ask_user>. Each entry: [text, rationale].
// Text goes to the model. Rationale stays in source.
// Changing ANY line requires reading ALL rationales first.
const LINES = [
	// --- Syntax: question attr + options in body
	['## <ask_user question="[Question?]">[option1; option2; ...]</ask_user>'],

	// --- Constraints FIRST: frames correct usage before examples
	[
		"* YOU SHOULD use for decisions, preferences, or approvals the user must make",
		"Positive framing. Shows what ask_user IS for, not just what it isn't.",
	],
	[
		"* YOU SHOULD use <get> to find information before asking the user",
		"Gentle redirect. Encourages self-sufficiency without forbidding interaction.",
	],

	// --- Examples: genuine decision points where user input is valuable
	[
		'Example: <ask_user question="Which test framework?">Mocha; Jest; Node Native</ask_user>',
		"Preference decision. Model truly cannot know this without asking.",
	],
	[
		'Example: <ask_user question="Deploy to staging or production?">staging; production</ask_user>',
		"Consequential action. Shows ask_user for high-stakes choices.",
	],
];

export default LINES.map(([text]) => text).join("\n");

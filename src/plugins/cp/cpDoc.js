// Tool doc for <cp>. Each entry: [text, rationale].
// Text goes to the model. Rationale stays in source.
// Changing ANY line requires reading ALL rationales first.
const LINES = [
	['## <cp path="[source]">[destination]</cp> - Copy a file or entry'],
	[
		'Example: <cp path="src/config.js">src/config.backup.js</cp>',
		"Simple file copy. Path = source, body = destination.",
	],
	[
		'Example: <cp path="known://plan_*">known://archive_</cp>',
		"Glob batch copy across known entries.",
	],
	[
		"* Source path accepts patterns: `src/*.js`, `known://draft_*`",
		"Pattern support consistent with get/rm.",
	],
	[
		"* Use `preview` to check matches before pattern-based bulk copy",
		"Safety pattern consistent with rm.",
	],
];

export default LINES.map(([text]) => text).join("\n");

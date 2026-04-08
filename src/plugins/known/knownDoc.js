// Tool doc for <known>. Each entry: [text, rationale].
// Text goes to the model. Rationale stays in source.
// Changing ANY line requires reading ALL rationales first.
const LINES = [
	// --- Syntax: body = the information to save
	["## <known>[information]</known> - Save what you learn for later recall"],

	// --- Examples: show the slug path convention and explicit naming
	[
		"Example: <known>Donald Rumsfeld was born in 1932</known>",
		"Auto-slugged path. Shows that bare known entries get slug paths from content.",
	],
	[
		'Example: <known path="known://auth">OAuth2 PKCE flow with rotating refresh tokens</known>',
		"Explicit path: model names the entry. Teaches known:// scheme convention.",
	],

	// --- Lifecycle: save → recall → archive
	[
		'* Recall with <get path="known://*">keyword</get>',
		"Cross-tool lifecycle: known entries are recalled via get with body filter.",
	],
	[
		'* Archive with <set path="known://..." stored/>',
		"Cross-tool lifecycle: full entries archived to storage when context is tight.",
	],
	[
		"* Entries are your memory — you forget everything not saved as known entries",
		"Critical behavioral constraint. Without this, models assume they'll remember across turns.",
	],
];

export default LINES.map(([text]) => text).join("\n");

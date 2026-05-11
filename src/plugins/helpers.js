import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Soft rule of thumb for tail-style projections (stream tail, etc.).
// Not engine-enforced — plugins decide their own caps.
export const SUMMARY_MAX_CHARS = 500;

// Tail-truncate stream output to last MAX_LINES, then chop to
// SUMMARY_MAX_CHARS for one-line giants. Used by sh/env when their
// streaming sh://N / env://N entries appear in <index>.
export function streamSummary(_label, entry, MAX_LINES = 20) {
	if (!entry.body) return "";
	const { body } = entry;
	const trailingNewline = body.endsWith("\n");
	const lines = trailingNewline
		? body.slice(0, -1).split("\n")
		: body.split("\n");
	const total = lines.length;
	const lineTail =
		total <= MAX_LINES
			? body
			: lines.slice(-MAX_LINES).join("\n") + (trailingNewline ? "\n" : "");
	return lineTail.length > SUMMARY_MAX_CHARS
		? lineTail.slice(0, SUMMARY_MAX_CHARS)
		: lineTail;
}

// Apply `1:\t<line>` numbering to a projected body. Display-only.
// The leading digit prevents column-zero `:::path` collisions and
// gives the model line refs for free (`<get path="X" lineFirst="42" lineFinal="46"/>`).
export function numberLines(body) {
	if (!body) return "";
	const trailingNewline = body.endsWith("\n");
	const source = trailingNewline ? body.slice(0, -1) : body;
	const lines = source.split("\n");
	const numbered = lines.map((line, i) => `${i + 1}:\t${line}`).join("\n");
	return trailingNewline ? `${numbered}\n` : numbered;
}

// Heredoc fence (path is the terminator) — distinct from XML so model
// emissions and entry projections can't collide. JSON meta sorted for
// prefix-cache stability.
export function renderEntry(path, metadata, body) {
	const meta = canonicalJson(metadata);
	if (!body) {
		return `${meta} <<:::${path}\n:::${path}`;
	}
	const trailingNewline = body.endsWith("\n") ? "" : "\n";
	return `${meta} <<:::${path}\n${body}${trailingNewline}:::${path}`;
}

function canonicalJson(obj) {
	const keys = Object.keys(obj).sort();
	const sorted = {};
	for (const k of keys) sorted[k] = obj[k];
	return JSON.stringify(sorted);
}

// Read sibling tooldoc .md, strip HTML comments (rationale stays out of
// the model packet) and collapse blank-line runs.
export function loadDoc(metaUrl, name) {
	const dir = dirname(fileURLToPath(metaUrl));
	return readFileSync(join(dir, name), "utf8")
		.replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*\n?/gm, "")
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

// log://<L>/<T>/<S>/<action> → <action>://<L>/<T>/<S>
// Used by streaming actions (sh, env) to derive their data-channel
// base path from the action's log entry path.
export function logPathToDataBase(logPath) {
	const m = logPath?.match(/^log:\/\/(\d+)\/(\d+)\/(\d+)\/(\w+)$/);
	if (!m) return null;
	return `${m[4]}://${m[1]}/${m[2]}/${m[3]}`;
}

export async function storePatternResult(
	store,
	runId,
	turn,
	scheme,
	path,
	bodyFilter,
	matches,
	{ manifest = false, loopId = null, attributes = null } = {},
) {
	const logSlug = await store.logPath(runId, loopId, turn, scheme);
	const filter = bodyFilter ? ` body="${bodyFilter}"` : "";
	const total = matches.reduce((s, m) => s + m.tokens, 0);
	const listing = matches.map((m) => manifestLine(m.path, m.tokens)).join("\n");
	const prefix = manifest ? "MANIFEST " : "";
	const body = `${prefix}${scheme} path="${path}"${filter}: ${matches.length} matched (${total} tokens)\n${listing}`;
	await store.set({
		runId,
		turn,
		path: logSlug,
		body,
		state: "resolved",
		loopId,
		attributes,
	});
}

// Canonical manifest row — one JSON object per line. Matches the
// `{...} <<:::path` log-entry envelope so the model parses both with
// the same primitive. Sister plugins (rummy.web, rummy.repo) should
// import this helper rather than reinventing the row shape.
export function manifestLine(path, tokens) {
	return JSON.stringify({ path, tokens });
}

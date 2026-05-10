import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Hard ceiling on <index> body projections. Catalog entries (known,
// unknown, file) get summarized this small so the index stays a
// glance-and-scan ls; full bodies arrive via <get> into <log>.
export const SUMMARY_MAX_CHARS = 500;

// Tab-indent every line so a column-zero `:::path` in the body can't
// prematurely close the outer heredoc envelope.
export function projectEmission(source) {
	if (!source) return "";
	return source
		.split("\n")
		.map((line) => `\t${line}`)
		.join("\n");
}

// Catalog projection: tab-indented and capped post-projection. Used by
// known/unknown/file when their entries land in <index>.
export function summarizeEmission(body) {
	if (!body) return "";
	const projected = projectEmission(body);
	return projected.length > SUMMARY_MAX_CHARS
		? projected.slice(0, SUMMARY_MAX_CHARS)
		: projected;
}

// Tail-truncate stream output to last MAX_LINES, then chop to
// SUMMARY_MAX_CHARS for one-line giants (ANSI/cmatrix shape). Used
// by sh/env when their streaming sh://N / env://N entries land in <log>.
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

export function logPathToDataBase(logPath) {
	const m = logPath?.match(/^log:\/\/turn_(\d+)\/([^/]+)\/(.+)$/);
	if (!m) return null;
	return `${m[2]}://turn_${m[1]}/${m[3]}`;
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
	const logSlug = await store.logPath(runId, turn, scheme, path);
	const filter = bodyFilter ? ` body="${bodyFilter}"` : "";
	const total = matches.reduce((s, m) => s + m.tokens, 0);
	const listing = matches.map((m) => `${m.path} (${m.tokens})`).join("\n");
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

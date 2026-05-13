// Single-heredoc extractor for non-`<set>` tools. The model wraps
// opaque multi-line content (sh commands, persona bodies, etc.) in
// `<<IDENT...IDENT` so internal `<` characters can't be misread as
// tool tags. `<set>` no longer uses this — its body is udiffberg
// (see `udiff.js`).

const KEYWORD_RE =
	/^(NEW|PREPEND|APPEND|REPLACE|DELETE|SEARCH)([A-Za-z0-9_]*)(?:\[(\d+)(?:-(\d+))?\])?$/;

const OPENER_RE = /(?<=^|[\s>])<<([A-Z][A-Za-z0-9_]*(?:\[\d+(?:-\d+)?\])?)/;

function operationFromIdent(ident) {
	const m = ident.match(KEYWORD_RE);
	if (!m) return { op: "replace", scope: null, suffix: "", keyword: "" };
	const op = m[1].toLowerCase();
	const suffix = m[2] || "";
	const keyword = m[1];
	if (m[3] == null) return { op, scope: null, suffix, keyword };
	const start = Number(m[3]);
	const end = m[4] != null ? Number(m[4]) : start;
	return { op, scope: { start, end }, suffix, keyword };
}

function findOpener(body, startIdx) {
	const slice = body.slice(startIdx);
	const match = slice.match(OPENER_RE);
	if (!match) return null;
	return {
		ident: match[1],
		openerStart: startIdx + match.index,
		openerEnd: startIdx + match.index + match[0].length,
	};
}

function findCloser(body, startIdx, ident, parsed) {
	const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	let re;
	if (parsed && parsed.op === "search" && parsed.scope) {
		const kw = escapeRe(parsed.keyword);
		const sf = escapeRe(parsed.suffix);
		re = new RegExp(
			`(?<=^|\\s)${kw}${sf}\\[(\\d+)(?:-(\\d+))?\\](?=[\\s<>]|$)`,
		);
	} else {
		re = new RegExp(`(?<=^|\\s)${escapeRe(ident)}(?=[\\s<>]|$)`);
	}
	const slice = body.slice(startIdx);
	const match = slice.match(re);
	if (!match) return null;
	return {
		closerStart: startIdx + match.index,
		closerEnd: startIdx + match.index + match[0].length,
	};
}

function trimMarkerNewlines(content) {
	let result = content;
	if (result.startsWith("\n")) result = result.slice(1);
	if (result.endsWith("\n")) result = result.slice(0, -1);
	return result;
}

// Returns { ident, content } if `body` is exactly one heredoc; null otherwise.
export function extractSingleHeredoc(body) {
	if (!body) return null;
	const trimmed = body.trim();
	if (!trimmed.startsWith("<<")) return null;

	const opener = findOpener(trimmed, 0);
	if (!opener || opener.openerStart !== 0) return null;

	const parsed = operationFromIdent(opener.ident);
	const closer = findCloser(trimmed, opener.openerEnd, opener.ident, parsed);
	if (!closer || closer.closerEnd !== trimmed.length) return null;

	const content = trimMarkerNewlines(
		trimmed.slice(opener.openerEnd, closer.closerStart),
	);
	return { ident: opener.ident, content };
}

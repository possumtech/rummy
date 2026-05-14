// Heredoc parsing for tool bodies.
//
//   - `<set>` bodies are SEQUENCES of operation heredocs:
//     `<<NEW...NEW`, `<<APPEND...APPEND`, `<<PREPEND...PREPEND`,
//     `<<REPLACE[N]...REPLACE[M]`, `<<DELETE[N]...DELETE[M]`.
//     Asymmetric brackets on REPLACE/DELETE express the line range:
//     opener carries the start line, closer carries the end (inclusive).
//     For single-line ops the close echoes the open's number.
//   - Non-set tools may wrap their body in a single heredoc for opacity
//     (`<sh>`, persona bodies, etc.) using `extractSingleHeredoc`.
//
// Suffix support: any IDENT may carry an alphanumeric suffix
// (`NEWdoc`, `REPLACE_demo[5]`). The parser recognizes the base
// operation but ops with non-empty suffix are NOT executed —
// reserved for documenting the syntax in body content without
// triggering side effects.

const KEYWORD_RE =
	/^(NEW|PREPEND|APPEND|REPLACE|DELETE)([A-Za-z0-9_]*)(?:\[(\d+)(?:-(\d+))?\])?$/;

const OPENER_RE = /(?<=^|[\s>])<<([A-Z][A-Za-z0-9_]*(?:\[\d+(?:-\d+)?\])?)/;

function operationFromIdent(ident) {
	const m = ident.match(KEYWORD_RE);
	if (!m) return { op: null, scope: null, suffix: "", keyword: "" };
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
	// REPLACE/DELETE close with asymmetric brackets — opener carries the
	// start line, closer the end line. Match `KEYWORD[N]` or
	// `KEYWORD[N-M]`, preserving the same suffix as the opener so a
	// `REPLACE_demo[5]` close matches only its `REPLACE_demo[10]` opener.
	if (parsed?.scope && (parsed.op === "replace" || parsed.op === "delete")) {
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
	const closerText = match[0];
	const bracketMatch = closerText.match(/\[(\d+)(?:-(\d+))?\]$/);
	const closerScope = bracketMatch
		? {
				start: Number(bracketMatch[1]),
				end:
					bracketMatch[2] != null
						? Number(bracketMatch[2])
						: Number(bracketMatch[1]),
			}
		: null;
	return {
		closerStart: startIdx + match.index,
		closerEnd: startIdx + match.index + match[0].length,
		closerScope,
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

// Multi-heredoc extractor for `<set>` bodies. Returns
//   { ops: [{op, suffix, keyword, scope, content}, ...] }
// or { error: "..." } on parse failure. `scope = {start, end}` for
// REPLACE/DELETE (inclusive line range derived from opener's start
// bracket and closer's end bracket). Ops with non-empty `suffix` are
// returned but the caller (set.js handler) does not execute them —
// reserved for documenting the grammar inside body content.
export function parseHeredocOps(body) {
	if (!body) return { ops: [] };
	const ops = [];
	let pos = 0;
	while (pos < body.length) {
		const opener = findOpener(body, pos);
		if (!opener) {
			const remainder = body.slice(pos).trim();
			if (remainder) {
				return {
					error: `unparsed content outside heredoc operation: ${remainder.slice(0, 80)}`,
				};
			}
			break;
		}
		const between = body.slice(pos, opener.openerStart).trim();
		if (between) {
			return {
				error: `unparsed content between heredoc operations: ${between.slice(0, 80)}`,
			};
		}
		const parsed = operationFromIdent(opener.ident);
		if (!parsed.op) {
			return { error: `unknown operation: ${opener.ident}` };
		}
		const closer = findCloser(body, opener.openerEnd, opener.ident, parsed);
		if (!closer) {
			return { error: `missing closer for <<${opener.ident}` };
		}
		const content = trimMarkerNewlines(
			body.slice(opener.openerEnd, closer.closerStart),
		);
		const scope =
			parsed.scope && closer.closerScope
				? { start: parsed.scope.start, end: closer.closerScope.end }
				: parsed.scope;
		ops.push({
			op: parsed.op,
			suffix: parsed.suffix,
			keyword: parsed.keyword,
			scope,
			content,
		});
		pos = closer.closerEnd;
	}
	return { ops };
}

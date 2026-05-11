// Edit-syntax marker parser for `<set>` bodies. Grammar in SPEC.md "Edit Syntax".
// Returns { ops, error } — `ops: null` on either no-markers or parse failure.
//
// SEARCH supports an optional line-range scope spread across opener/closer:
// `<<SEARCH[X]…SEARCH[Y]<<REPLACE…REPLACE` — opener's bracket carries the
// first line, closer's bracket carries the final line. Single-line form
// (X === Y) is the trivial case. `<<SEARCH…SEARCH<<REPLACE…REPLACE` (no
// brackets) is the literal-content-match form. Search_replace ops carry
// `scope: { start, end }` when scoped.
//
// Non-SEARCH ops (NEW/PREPEND/APPEND/REPLACE/DELETE) follow the strict
// closer-equals-opener rule. They never carry a scope today.

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

// For SEARCH openers with a scoped opener, the closer matches keyword+suffix
// and carries its OWN `[N]` (or `[N-M]`) bracket — that bracket provides the
// FINAL line of the range. For all other cases (non-SEARCH, or unscoped
// SEARCH), the closer must repeat the opener ident verbatim.
function findCloser(body, startIdx, ident, parsed) {
	const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	let re;
	let captureCloserScope = false;
	if (parsed && parsed.op === "search" && parsed.scope) {
		const kw = escapeRe(parsed.keyword);
		const sf = escapeRe(parsed.suffix);
		re = new RegExp(
			`(?<=^|\\s)${kw}${sf}\\[(\\d+)(?:-(\\d+))?\\](?=[\\s<>]|$)`,
		);
		captureCloserScope = true;
	} else {
		// Trailing `<` lets `SEARCH<<REPLACE` adjoin without intermediate whitespace.
		re = new RegExp(`(?<=^|\\s)${escapeRe(ident)}(?=[\\s<>]|$)`);
	}
	const slice = body.slice(startIdx);
	const match = slice.match(re);
	if (!match) return null;
	return {
		closerStart: startIdx + match.index,
		closerEnd: startIdx + match.index + match[0].length,
		closerScope: captureCloserScope
			? {
					start: Number(match[1]),
					end: match[2] != null ? Number(match[2]) : Number(match[1]),
				}
			: null,
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

export function parseMarkerBody(body) {
	if (!/<<[A-Z]/.test(body)) return { ops: null, error: null };

	const raw = [];
	let i = 0;
	while (i < body.length) {
		const opener = findOpener(body, i);
		if (!opener) break;
		const parsed = operationFromIdent(opener.ident);
		const { op, scope } = parsed;
		const closer = findCloser(body, opener.openerEnd, opener.ident, parsed);
		if (!closer) {
			// Tail-close recovery: last opener with no closer and no further
			// opener absorbs body to EOF. SEARCH stays strict (needs REPLACE).
			if (op === "search") {
				return { ops: null, error: `unclosed <<${opener.ident}` };
			}
			const tail = body.slice(opener.openerEnd);
			if (findOpener(tail, 0)) {
				return { ops: null, error: `unclosed <<${opener.ident}` };
			}
			raw.push({ op, scope, content: trimMarkerNewlines(tail) });
			break;
		}
		const content = trimMarkerNewlines(
			body.slice(opener.openerEnd, closer.closerStart),
		);
		// Scoped SEARCH: opener bracket = first line, closer bracket = final.
		// Combine into a single scope on the op. `[X]` on both sides
		// collapses to start=end=X (the single-line case).
		let effectiveScope = scope;
		if (op === "search" && scope && closer.closerScope) {
			const start = scope.start;
			const end = closer.closerScope.start;
			if (end < start) {
				return {
					ops: null,
					error: `SEARCH[${start}]…SEARCH[${end}] — closer line ${end} precedes opener line ${start}`,
				};
			}
			effectiveScope = { start, end };
		}
		raw.push({ op, scope: effectiveScope, content });
		i = closer.closerEnd;
	}
	if (raw.length === 0) return { ops: null, error: null };

	const ops = [];
	for (let j = 0; j < raw.length; j++) {
		const cur = raw[j];
		if (cur.op === "search") {
			const next = raw[j + 1];
			if (!next || next.op !== "replace") {
				return { ops: null, error: "lone SEARCH (no REPLACE)" };
			}
			ops.push({
				op: "search_replace",
				search: cur.content,
				replace: next.content,
				...(cur.scope ? { scope: cur.scope } : {}),
			});
			j++;
		} else {
			ops.push({ op: cur.op, content: cur.content });
		}
	}
	return { ops, error: null };
}

// Edit-syntax marker parser for `<set>` bodies. Grammar in SPEC.md "Edit Syntax".
// Returns { ops, error } — `ops: null` on either no-markers or parse failure.

const KEYWORD_RE =
	/^(NEW|PREPEND|APPEND|REPLACE|DELETE|SEARCH)([A-Za-z0-9_]*)$/;

const OPENER_RE = /(?<=^|[\s>])<<([A-Z][A-Za-z0-9_]*)/;

function operationFromIdent(ident) {
	const m = ident.match(KEYWORD_RE);
	if (m) return m[1].toLowerCase();
	return "replace";
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

function findCloser(body, startIdx, ident) {
	const escIdent = ident.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	// Trailing `<` lets `SEARCH<<REPLACE` adjoin without intermediate whitespace.
	const re = new RegExp(`(?<=^|\\s)${escIdent}(?=[\\s<>]|$)`);
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

	const closer = findCloser(trimmed, opener.openerEnd, opener.ident);
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
		const op = operationFromIdent(opener.ident);
		const closer = findCloser(body, opener.openerEnd, opener.ident);
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
			raw.push({ op, content: trimMarkerNewlines(tail) });
			break;
		}
		const content = trimMarkerNewlines(
			body.slice(opener.openerEnd, closer.closerStart),
		);
		raw.push({ op, content });
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
			});
			j++;
		} else {
			ops.push(cur);
		}
	}
	return { ops, error: null };
}

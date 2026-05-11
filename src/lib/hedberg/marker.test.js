import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractSingleHeredoc, parseMarkerBody } from "./marker.js";

describe("parseMarkerBody — keyword operations", () => {
	it("plain body (no markers) returns null ops", () => {
		const r = parseMarkerBody("just a plain body without any markers");
		assert.equal(r.ops, null);
		assert.equal(r.error, null);
	});

	it("NEW: bracketed multi-line", () => {
		const r = parseMarkerBody("<<NEW\nfile contents\nNEW");
		assert.deepEqual(r.ops, [{ op: "new", content: "file contents" }]);
	});

	it("APPEND: single-line newline-tolerant", () => {
		const r = parseMarkerBody("<<APPEND extra APPEND");
		assert.deepEqual(r.ops, [{ op: "append", content: " extra " }]);
	});

	it("PREPEND: prepends content", () => {
		const r = parseMarkerBody("<<PREPEND\nheader\nPREPEND");
		assert.deepEqual(r.ops, [{ op: "prepend", content: "header" }]);
	});

	it("REPLACE: standalone full-body replace", () => {
		const r = parseMarkerBody("<<REPLACE\nnew body\nREPLACE");
		assert.deepEqual(r.ops, [{ op: "replace", content: "new body" }]);
	});

	it("DELETE: removes content", () => {
		const r = parseMarkerBody("<<DELETE\ndead code\nDELETE");
		assert.deepEqual(r.ops, [{ op: "delete", content: "dead code" }]);
	});

	it("SEARCH/REPLACE pair → single search_replace op (clean newline style)", () => {
		const body = [
			"<<SEARCH",
			"old line",
			"SEARCH",
			"<<REPLACE",
			"new line",
			"REPLACE",
		].join("\n");
		const r = parseMarkerBody(body);
		assert.deepEqual(r.ops, [
			{ op: "search_replace", search: "old line", replace: "new line" },
		]);
	});

	it("SEARCH/REPLACE pair with glued bridge (SEARCH<<REPLACE)", () => {
		const body = [
			"<<SEARCH",
			"old line",
			"SEARCH<<REPLACE",
			"new line",
			"REPLACE",
		].join("\n");
		const r = parseMarkerBody(body);
		assert.deepEqual(r.ops, [
			{ op: "search_replace", search: "old line", replace: "new line" },
		]);
	});

	it("multiple SEARCH/REPLACE pairs apply in order", () => {
		const body = [
			"<<SEARCH",
			"a",
			"SEARCH",
			"<<REPLACE",
			"A",
			"REPLACE",
			"",
			"<<SEARCH",
			"b",
			"SEARCH",
			"<<REPLACE",
			"B",
			"REPLACE",
		].join("\n");
		const r = parseMarkerBody(body);
		assert.equal(r.ops.length, 2);
		assert.equal(r.ops[0].op, "search_replace");
		assert.equal(r.ops[0].search, "a");
		assert.equal(r.ops[0].replace, "A");
		assert.equal(r.ops[1].search, "b");
	});

	it("mixed ops in one body apply in order", () => {
		const body = "<<APPEND tail APPEND<<PREPEND head PREPEND";
		const r = parseMarkerBody(body);
		assert.deepEqual(r.ops, [
			{ op: "append", content: " tail " },
			{ op: "prepend", content: " head " },
		]);
	});

	it("keyword + alphanumeric suffix routes to keyword op (nesting disambiguator)", () => {
		const body = [
			"<<SEARCH1",
			"old",
			"SEARCH1",
			"<<REPLACE1",
			"new",
			"REPLACE1",
		].join("\n");
		const r = parseMarkerBody(body);
		assert.deepEqual(r.ops, [
			{ op: "search_replace", search: "old", replace: "new" },
		]);
	});
});

describe("parseMarkerBody — non-keyword IDENT routes to REPLACE", () => {
	it("DOC IDENT: full-body replace with literal content", () => {
		const body = "<<DOC\nfull document body\nDOC";
		const r = parseMarkerBody(body);
		assert.deepEqual(r.ops, [{ op: "replace", content: "full document body" }]);
	});

	it("EOF IDENT (bash convention)", () => {
		const r = parseMarkerBody("<<EOF\ncontent\nEOF");
		assert.deepEqual(r.ops, [{ op: "replace", content: "content" }]);
	});

	it("body containing keyword literally — outer wraps it via custom IDENT", () => {
		const body = [
			"<<DOC",
			"The opener is <<SEARCH and the closer is bare SEARCH.",
			"DOC",
		].join("\n");
		const r = parseMarkerBody(body);
		assert.deepEqual(r.ops, [
			{
				op: "replace",
				content: "The opener is <<SEARCH and the closer is bare SEARCH.",
			},
		]);
	});
});

describe("parseMarkerBody — boundary anchoring", () => {
	it("mid-token `<<` does not false-trigger (vec<<SEARCH)", () => {
		const r = parseMarkerBody("vec<<SEARCH var SEARCH");
		assert.equal(r.ops, null);
		assert.equal(r.error, null);
	});

	it("lowercase IDENT does not trigger (`<<eof`)", () => {
		const r = parseMarkerBody("<<eof\ncontent\neof");
		assert.equal(r.ops, null);
		assert.equal(r.error, null);
	});

	it("packet-shape `<<:::IDENT` does not trigger edit syntax", () => {
		// Engine emits `<<:::path` for entry rendering (plugins/helpers.js).
		// Edit syntax is bare-only — packet shape falls through to
		// plain-body REPLACE with the markers preserved as literal
		// content. The two grammars stay distinct.
		const body = "<<:::OC_RIVERS.md\ncontent\n:::OC_RIVERS.md";
		const r = parseMarkerBody(body);
		assert.equal(r.ops, null);
		assert.equal(r.error, null);
	});
});

describe("parseMarkerBody — errors", () => {
	it("lone SEARCH (no following REPLACE) → parse error", () => {
		const body = "<<SEARCH\nold\nSEARCH";
		const r = parseMarkerBody(body);
		assert.equal(r.ops, null);
		assert.match(r.error, /lone SEARCH/);
	});

	it("SEARCH followed by non-REPLACE op → parse error", () => {
		const body = "<<SEARCH\na\nSEARCH<<APPEND b APPEND";
		const r = parseMarkerBody(body);
		assert.equal(r.ops, null);
		assert.match(r.error, /lone SEARCH/);
	});

	it("unclosed SEARCH → parse error (no REPLACE pair to recover)", () => {
		const body = "<<SEARCH content but no closer";
		const r = parseMarkerBody(body);
		assert.equal(r.ops, null);
		assert.match(r.error, /unclosed.*SEARCH/);
	});

	it("unclosed marker before another opener → ambiguous, stays strict", () => {
		// Two openers, first one missing its close, second one is well-
		// formed: we can't tell where the first was meant to end.
		const body = "<<APPEND a\n<<NEW b NEW";
		const r = parseMarkerBody(body);
		assert.equal(r.ops, null);
		assert.match(r.error, /unclosed.*APPEND/);
	});
});

describe("parseMarkerBody — tail-close recovery", () => {
	it("trailing unclosed NEW → content from opener to body-end becomes NEW", () => {
		// Real model pattern: model emits `<<NEW [content] </set>`,
		// forgets the inner `NEW` close. XML parser already extracts
		// the body via `</set>`; we recover the heredoc content from
		// open marker to body-end.
		const body = "<<NEW\nfile contents\n";
		const r = parseMarkerBody(body);
		assert.deepEqual(r.ops, [{ op: "new", content: "file contents" }]);
		assert.equal(r.error, null);
	});

	it("trailing unclosed APPEND → recovered as APPEND op", () => {
		const body = "<<APPEND\nmore stuff";
		const r = parseMarkerBody(body);
		assert.deepEqual(r.ops, [{ op: "append", content: "more stuff" }]);
		assert.equal(r.error, null);
	});

	it("trailing unclosed REPLACE (standalone) → recovered as full-body replace", () => {
		const body = "<<REPLACE\nnew body\n";
		const r = parseMarkerBody(body);
		assert.deepEqual(r.ops, [{ op: "replace", content: "new body" }]);
		assert.equal(r.error, null);
	});

	it("trailing unclosed non-keyword IDENT → recovered as REPLACE", () => {
		// Model invented a label, forgot to close it. Same routing as
		// any non-keyword IDENT — REPLACE — applied to recovered content.
		const body = "<<ADD_IMPORTS\nimport os\nimport sys";
		const r = parseMarkerBody(body);
		assert.deepEqual(r.ops, [
			{ op: "replace", content: "import os\nimport sys" },
		]);
		assert.equal(r.error, null);
	});

	it("multi-op with trailing unclosed → earlier ops parse, last recovers", () => {
		// First NEW closes properly; trailing APPEND has no close.
		const body = "<<NEW\nfirst\nNEW\n<<APPEND\nsecond";
		const r = parseMarkerBody(body);
		assert.deepEqual(r.ops, [
			{ op: "new", content: "first" },
			{ op: "append", content: "second" },
		]);
		assert.equal(r.error, null);
	});
});

describe("parseMarkerBody — nesting via IDENT suffix", () => {
	it("inner markers with different IDENT survive as content of outer", () => {
		const body = [
			"<<SEARCH_OUTER",
			"<<SEARCH",
			"inner old",
			"SEARCH",
			"<<REPLACE",
			"inner new",
			"REPLACE",
			"SEARCH_OUTER",
			"<<REPLACE_OUTER",
			"replacement",
			"REPLACE_OUTER",
		].join("\n");
		const r = parseMarkerBody(body);
		assert.deepEqual(r.ops, [
			{
				op: "search_replace",
				search: [
					"<<SEARCH",
					"inner old",
					"SEARCH",
					"<<REPLACE",
					"inner new",
					"REPLACE",
				].join("\n"),
				replace: "replacement",
			},
		]);
	});
});

describe("extractSingleHeredoc — generic plugin body wrapper", () => {
	it("multi-line wrap returns ident and inner content", () => {
		const body = "<<PYTHON\nprint('hi')\nPYTHON";
		const r = extractSingleHeredoc(body);
		assert.deepEqual(r, { ident: "PYTHON", content: "print('hi')" });
	});

	it("single-line wrap returns ident and content", () => {
		const r = extractSingleHeredoc("<<EOF some content EOF");
		assert.deepEqual(r, { ident: "EOF", content: " some content " });
	});

	it("tolerates surrounding whitespace", () => {
		const r = extractSingleHeredoc("\n\n  <<MARK\nbody\nMARK  \n\n");
		assert.deepEqual(r, { ident: "MARK", content: "body" });
	});

	it("returns null when content exists before the opener", () => {
		const r = extractSingleHeredoc("prefix <<EOF\ncontent\nEOF");
		assert.equal(r, null);
	});

	it("returns null when content exists after the closer", () => {
		const r = extractSingleHeredoc("<<EOF\ncontent\nEOF tail");
		assert.equal(r, null);
	});

	it("returns null when body has no heredoc", () => {
		assert.equal(extractSingleHeredoc("plain text"), null);
		assert.equal(extractSingleHeredoc(""), null);
		assert.equal(extractSingleHeredoc(null), null);
		assert.equal(extractSingleHeredoc(undefined), null);
	});

	it("returns null when opener has no matching closer", () => {
		assert.equal(extractSingleHeredoc("<<EOF\ncontent without closer"), null);
	});

	it("returns null on multiple sibling heredocs", () => {
		// Two adjacent heredocs is a `<set>`-style multi-op pattern, not a
		// generic single-wrap. Caller should use parseMarkerBody for that.
		const body = "<<APPEND a APPEND<<PREPEND b PREPEND";
		assert.equal(extractSingleHeredoc(body), null);
	});

	it("non-keyword IDENT (DOC, EOF, custom)", () => {
		const r = extractSingleHeredoc("<<DOC\nfree-form prose\nDOC");
		assert.deepEqual(r, { ident: "DOC", content: "free-form prose" });
	});

	it("suffixed IDENT for nesting (EOF_OUTER wrapping <<EOF inside)", () => {
		const r = extractSingleHeredoc(
			"<<EOF_OUTER\ninner <<EOF nested EOF\nEOF_OUTER",
		);
		assert.deepEqual(r, {
			ident: "EOF_OUTER",
			content: "inner <<EOF nested EOF",
		});
	});
});

describe("parseMarkerBody — scoped SEARCH/REPLACE", () => {
	it("single-line scope: SEARCH[5] parses as search_replace with scope.start=end=5", () => {
		const r = parseMarkerBody(
			"<<SEARCH[5]\nold line\nSEARCH[5]<<REPLACE\nnew line\nREPLACE",
		);
		assert.deepEqual(r.ops, [
			{
				op: "search_replace",
				search: "old line",
				replace: "new line",
				scope: { start: 5, end: 5 },
			},
		]);
	});

	it("range scope: SEARCH[5-10] parses as search_replace with scope.start=5 end=10", () => {
		const r = parseMarkerBody(
			"<<SEARCH[5-10]\nold block\nSEARCH[5-10]<<REPLACE\nnew block\nREPLACE",
		);
		assert.deepEqual(r.ops, [
			{
				op: "search_replace",
				search: "old block",
				replace: "new block",
				scope: { start: 5, end: 10 },
			},
		]);
	});

	it("close marker must repeat the scope verbatim", () => {
		// SEARCH[5] opener cannot pair with SEARCH closer.
		const r = parseMarkerBody(
			"<<SEARCH[5]\nold\nSEARCH<<REPLACE\nnew\nREPLACE",
		);
		assert.equal(r.ops, null);
		assert.match(r.error, /unclosed/);
	});

	it("empty SEARCH body (trust-the-numbers form, undocumented)", () => {
		const r = parseMarkerBody(
			"<<SEARCH[5-7]\nSEARCH[5-7]<<REPLACE\nnew block\nREPLACE",
		);
		assert.deepEqual(r.ops, [
			{
				op: "search_replace",
				search: "",
				replace: "new block",
				scope: { start: 5, end: 7 },
			},
		]);
	});

	it("unscoped SEARCH/REPLACE still parses with no scope on the op", () => {
		const r = parseMarkerBody("<<SEARCH\nold\nSEARCH<<REPLACE\nnew\nREPLACE");
		assert.deepEqual(r.ops, [
			{ op: "search_replace", search: "old", replace: "new" },
		]);
	});

	it("multi-hunk scoped + unscoped in the same body", () => {
		const body =
			"<<SEARCH[3-3]\nA\nSEARCH[3-3]<<REPLACE\na\nREPLACE<<SEARCH\nB\nSEARCH<<REPLACE\nb\nREPLACE";
		const r = parseMarkerBody(body);
		assert.equal(r.ops.length, 2);
		assert.deepEqual(r.ops[0].scope, { start: 3, end: 3 });
		assert.equal(r.ops[1].scope, undefined);
	});
});

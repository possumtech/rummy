import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractSingleHeredoc } from "./marker.js";

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
		// Two adjacent heredocs is a multi-op pattern, not a generic
		// single-wrap. <set> uses udiffberg now (see udiff.js); other
		// tools accept a single opaque heredoc wrapper only.
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

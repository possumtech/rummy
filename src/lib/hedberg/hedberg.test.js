import assert from "node:assert/strict";
import { describe, it } from "node:test";
import createHooks from "../../hooks/Hooks.js";
import PluginContext from "../../hooks/PluginContext.js";
import Hedberg from "./hedberg.js";

describe("Hedberg plugin", () => {
	it("constructor exposes hedberg utilities on core.hooks.hedberg", () => {
		const hooks = createHooks();
		const core = new PluginContext("hedberg", hooks);
		new Hedberg(core);
		assert.equal(typeof hooks.hedberg.match, "function");
		assert.equal(typeof hooks.hedberg.search, "function");
		assert.equal(typeof hooks.hedberg.replace, "function");
		assert.equal(typeof hooks.hedberg.generatePatch, "function");
	});

	describe("Hedberg.replace", () => {
		it("line-anchored: SEARCH must match complete lines, not substrings within a line", () => {
			// The body is `foo bar foo` — `foo` appears twice but never
			// at line boundaries (always with non-newline neighbors).
			// Strict semantics: no match. The heuristic fallback also
			// can't synthesize a result (single short token).
			const result = Hedberg.replace("foo bar foo", "foo", "baz");
			assert.ok(!result.patch);
		});

		it("line-anchored: SEARCH matches when boundaries land at start/end of body", () => {
			// `foo` alone in the body — start-of-body + end-of-body
			// boundaries both satisfied.
			const result = Hedberg.replace("foo", "foo", "baz");
			assert.equal(result.patch, "baz");
		});

		it("line-anchored: SEARCH matches a whole line in a multi-line body", () => {
			const result = Hedberg.replace("alpha\nfoo\nbeta\n", "foo", "baz");
			assert.equal(result.patch, "alpha\nbaz\nbeta\n");
		});

		it("line-anchored: SEARCH is a prefix of an existing line → no match (regression: T4 plan corruption)", () => {
			// Bug we're locking against: SEARCH `- [ ] Discover` would
			// previously splice into `- [ ] Discover (rivers...)` mid-
			// line, drag the trailing parenthetical onto the REPLACE
			// body, and leave the rest of the file out of place. With
			// line-anchoring, the partial-prefix match is rejected and
			// the model gets accurate conflict feedback.
			const body =
				"- [ ] Draft\n- [ ] Discover (rivers, streams)\n- [ ] Distill\n";
			const result = Hedberg.replace(
				body,
				"- [ ] Discover",
				"- [x] Discover\n   - [x] sub-item",
			);
			assert.ok(
				!result.patch,
				"prefix substring of a longer line must NOT match",
			);
		});

		it("line-anchored: multi-line SEARCH spans complete lines and replaces them", () => {
			const body = "a\nb\nc\nd\n";
			const result = Hedberg.replace(body, "b\nc", "X\nY\nZ");
			assert.equal(result.patch, "a\nX\nY\nZ\nd\n");
		});

		it("returns no patch (via heuristic) when literal search not found and heuristic also fails", () => {
			const result = Hedberg.replace("nothing matches", "absent", "x");
			assert.ok(!result.patch);
		});

		it("sed=true literal semantics: `\\d` matches the literal string, not digits", () => {
			// sed semantics in our context: literal substitution under
			// line-anchored matching. `\d` is the literal two-char string
			// "\d" — not a digit class. The body has no "\d", so no match.
			const result = Hedberg.replace("a1 b2 c3", "\\d", "X", { sed: true });
			assert.ok(!result.patch);
		});

		it("sed=true unescapes regex-meta backslashes (literal char appears in search/replace)", () => {
			// Model muscle-memory writes `\[` to mean a literal `[`.
			// With sed=true the backslash is stripped from search/replace
			// so the body's literal char is what's matched/written.
			// Body has the literal `[bar]`; search is `\[bar\]` which
			// strips to `[bar]` and matches the whole line.
			const result = Hedberg.replace("[bar]", "\\[bar\\]", "[y]", {
				sed: true,
			});
			assert.equal(result.patch, "[y]");
		});

		it("preserves searchText / replaceText in the result", () => {
			const result = Hedberg.replace("hello", "hello", "world");
			assert.equal(result.searchText, "hello");
			assert.equal(result.replaceText, "world");
		});

		// Lock in the literal-substitution contract: sed=true does NOT
		// compile a regex. The model's regex-shaped patterns either match
		// as literal whole-line strings or don't match at all.
		describe("regex semantics are NOT honored under sed=true", () => {
			it("anchors `^` and `$` are literal characters", () => {
				const r1 = Hedberg.replace("foo bar", "^foo", "X", { sed: true });
				assert.ok(!r1.patch, "^foo doesn't match because ^ is literal");
				// Whole-line match for `price$10` — the $ is literal dollar.
				const r2 = Hedberg.replace("price$10", "price$10", "cost$10", {
					sed: true,
				});
				assert.equal(r2.patch, "cost$10");
			});

			it("character classes `[...]` are literal", () => {
				const r = Hedberg.replace("abc xyz", "[abc]", "X", { sed: true });
				assert.ok(!r.patch, "[abc] doesn't match a/b/c — it's literal text");
			});

			it("quantifiers `*`, `+`, `?` are literal", () => {
				const r = Hedberg.replace("aaa", "a+", "X", { sed: true });
				assert.ok(!r.patch, "a+ doesn't match repeats");
			});

			it("alternation `(a|b)` is literal", () => {
				const r = Hedberg.replace("yes maybe no", "(yes|no)", "X", {
					sed: true,
				});
				assert.ok(!r.patch);
			});

			it("`$1` in replacement is literal text, not a capture reference", () => {
				// Whole-line match; replacement contains literal `$1`.
				const r = Hedberg.replace("hello world", "hello world", "$1 there", {
					sed: true,
				});
				assert.equal(r.patch, "$1 there");
			});

			it("case-insensitive flag `i` is silently ignored", () => {
				const r = Hedberg.replace("Foo bar", "foo", "X", {
					sed: true,
					flags: "gi",
				});
				assert.ok(!r.patch, "case mismatch → no match (i flag has no effect)");
			});

			it("regex-style escapes ARE stripped to literal characters", () => {
				// Whole-line bodies so line anchors are satisfied.
				const r1 = Hedberg.replace("[x]", "\\[x\\]", "[y]", { sed: true });
				assert.equal(r1.patch, "[y]");
				const r2 = Hedberg.replace("v1.0", "v1\\.0", "v2.0", { sed: true });
				assert.equal(r2.patch, "v2.0");
			});

			it("multiple line-anchored matches all replaced; warning lists count", () => {
				const r = Hedberg.replace("a\na\na", "a", "b", { sed: true });
				assert.equal(r.patch, "b\nb\nb");
				assert.match(r.warning, /3 locations/);
			});
		});

		// sed=false stays the same: literal-only, no escape stripping (the
		// caller is passing exact bytes, e.g. from a SEARCH/REPLACE block).
		describe("sed=false (default) does not strip backslash escapes", () => {
			it("backslashes in search are preserved verbatim (whole-line match)", () => {
				const r = Hedberg.replace("\\[bar\\]", "\\[bar\\]", "X");
				assert.equal(r.patch, "X");
			});
		});
	});
});

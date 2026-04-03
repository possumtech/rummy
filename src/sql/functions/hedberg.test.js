import assert from "node:assert/strict";
import { describe, it } from "node:test";
import hedberg, { hedmatch, hedreplace, hedsearch } from "./hedberg.js";

describe("hedberg", () => {
	describe("glob patterns", () => {
		it("matches wildcard", () => {
			assert.equal(hedberg("*.js", "index.js"), 1);
			assert.equal(hedberg("*.js", "readme.md"), 0);
		});

		it("matches single char wildcard", () => {
			assert.equal(hedberg("????.ts", "test.ts"), 1);
			assert.equal(hedberg("????.ts", "index.ts"), 0);
		});

		it("matches globstar", () => {
			assert.equal(hedberg("src/**/*.ts", "src/a/b.ts"), 1);
			assert.equal(hedberg("src/**/*.ts", "lib/a.ts"), 0);
		});

		it("matches character class", () => {
			assert.equal(hedberg("[abc]*.js", "alpha.js"), 1);
			assert.equal(hedberg("[abc]*.js", "delta.js"), 0);
		});

		it("handles null string", () => {
			assert.equal(hedberg("*.js", null), 0);
		});
	});

	describe("glob NOT misdetected as regex", () => {
		it("file+name.txt stays glob", () => {
			assert.equal(hedberg("file+name.txt", "file+name.txt"), 1);
			assert.equal(hedberg("file+name.txt", "fileXname.txt"), 0);
		});

		it("c++ stays glob", () => {
			assert.equal(hedberg("c++", "c++"), 1);
		});

		it("parens in path stay glob", () => {
			assert.equal(
				hedberg("src/utils (copy)/*", "src/utils (copy)/file.js"),
				1,
			);
		});

		it("non-numeric brace expansion stays glob", () => {
			assert.equal(hedberg("log{a,b}.txt", "log{a,b}.txt"), 1);
		});

		it("globstar with dotted extensions stays glob", () => {
			assert.equal(hedberg("**/*.test.*", "src/foo.test.js"), 1);
			assert.equal(hedberg("**/*.test.*", "src/foo.js"), 0);
		});

		it("*.foo.* stays glob not regex", () => {
			assert.equal(hedberg("*.foo.*", "bar.foo.baz"), 1);
			assert.equal(hedberg("*.foo.*", "nope"), 0);
		});
	});

	describe("regex patterns (require /slashes/)", () => {
		it("slash-delimited regex matches", () => {
			assert.equal(hedberg("/^(index|utils)/", "index.js"), 1);
			assert.equal(hedberg("/^(index|utils)/", "readme.md"), 0);
		});

		it("regex with escape sequences", () => {
			assert.equal(hedberg("/\\.(js|ts)$/", "test.ts"), 1);
			assert.equal(hedberg("/\\.(js|ts)$/", "test.py"), 0);
		});

		it("regex with quantifiers", () => {
			assert.equal(hedberg("/foo.+bar/", "foo123bar"), 1);
			assert.equal(hedberg("/\\d+/", "abc123"), 1);
			assert.equal(hedberg("/\\d+/", "abcdef"), 0);
		});

		it("unslashed patterns are literal, not regex", () => {
			// Without slashes, these are literal text — no regex detection
			assert.equal(hedberg("\\d+", "\\d+"), 1);
			assert.equal(hedberg("\\d+", "abc123"), 0);
		});
	});

	describe("regex NOT misdetected as jsonpath", () => {
		it("$.+ with slashes is regex not jsonpath", () => {
			assert.equal(hedberg("/$.+/", "anything"), 0);
		});
	});

	describe("xpath patterns", () => {
		const xml =
			'<root><item id="3"><name>test</name></item><item id="5"/></root>';

		it("matches //element", () => {
			assert.equal(hedberg("//item", xml), 1);
			assert.equal(hedberg("//missing", xml), 0);
		});

		it("matches //element with attribute predicate", () => {
			assert.equal(hedberg("//item[@id='3']", xml), 1);
			assert.equal(hedberg("//item[@id='99']", xml), 0);
		});

		it("matches absolute path with positional predicate", () => {
			assert.equal(hedberg("/root/item[1]", xml), 1);
		});

		it("matches xpath with function in predicate", () => {
			assert.equal(hedberg("/root/item[position()>1]", xml), 1);
		});

		it("matches xpath with axis", () => {
			assert.equal(hedberg("//item/child::name", xml), 1);
		});

		it("returns 0 for non-XML string", () => {
			assert.equal(hedberg("//div", "just plain text"), 0);
		});
	});

	describe("xpath NOT misdetected", () => {
		it("C++ namespace path stays glob", () => {
			assert.equal(
				hedberg("/path/to/std::vector.html", "/path/to/std::vector.html"),
				1,
			);
		});
	});

	describe("jsonpath patterns", () => {
		const json = JSON.stringify({
			name: "alice",
			items: [{ id: 1 }, { id: 2 }],
			nested: { deep: { value: 42 } },
		});

		it("matches property access", () => {
			assert.equal(hedberg("$.name", json), 1);
		});

		it("matches nested property", () => {
			assert.equal(hedberg("$.nested.deep.value", json), 1);
		});

		it("matches array index", () => {
			assert.equal(hedberg("$.items[0].id", json), 1);
		});

		it("matches array wildcard", () => {
			assert.equal(hedberg("$.items[*].id", json), 1);
		});

		it("matches recursive descent", () => {
			assert.equal(hedberg("$..value", json), 1);
			assert.equal(hedberg("$..missing", json), 0);
		});

		it("returns 0 for missing key", () => {
			assert.equal(hedberg("$.missing", json), 0);
		});

		it("returns 0 for non-JSON string", () => {
			assert.equal(hedberg("$.name", "not json"), 0);
		});
	});

	describe("scheme paths stay glob", () => {
		it("edit:// is glob", () => {
			assert.equal(hedberg("edit://*", "edit://3"), 1);
		});

		it("summary:// is glob", () => {
			assert.equal(hedberg("summary://1", "summary://1"), 1);
		});
	});

	describe("literal detection (default)", () => {
		it("plain text without pattern chars is literal", () => {
			assert.equal(hedmatch(":AI[]", ":AI[]"), true);
			assert.equal(hedmatch(":AI[]", ":AI[x]"), false);
		});

		it("backslashes without /slashes/ are literal", () => {
			assert.equal(hedmatch("\\d+", "\\d+"), true);
			assert.equal(hedmatch("\\d+", "123"), false);
		});
	});

	describe("hedsearch — substring", () => {
		it("finds literal substring", () => {
			const r = hedsearch("port = 3000", "const port = 3000;\n");
			assert.equal(r.found, true);
			assert.equal(r.match, "port = 3000");
			assert.equal(r.index, 6);
		});

		it("finds :AI[] literally", () => {
			const r = hedsearch(":AI[]", "function() {\n:AI[]\n}");
			assert.equal(r.found, true);
			assert.equal(r.match, ":AI[]");
		});

		it("regex search with /slashes/", () => {
			const r = hedsearch("/\\d+/", "port = 3000");
			assert.equal(r.found, true);
			assert.equal(r.match, "3000");
		});

		it("glob search finds pattern in content", () => {
			const r = hedsearch("*.js", "import from app.js");
			assert.equal(r.found, true);
		});

		it("returns not found", () => {
			const r = hedsearch("missing", "nothing here");
			assert.equal(r.found, false);
		});
	});

	describe("hedreplace", () => {
		it("replaces literal", () => {
			const r = hedreplace("3000", "8080", "port = 3000");
			assert.equal(r, "port = 8080");
		});

		it("replaces with /regex/", () => {
			const r = hedreplace("/\\d+/", "NUM", "port = 3000");
			assert.equal(r, "port = NUM");
		});

		it("returns null when not found", () => {
			assert.equal(hedreplace("missing", "x", "nothing"), null);
		});
	});

	describe("sed syntax — s/search/replace/flags", () => {
		it("literal sed replace", () => {
			const r = hedreplace("s/3000/8080/", null, "port = 3000");
			assert.equal(r, "port = 8080");
		});

		it("sed with global flag uses regex", () => {
			const r = hedreplace("s/\\d+/NUM/g", null, "port = 3000, timeout = 5000");
			assert.equal(r, "port = NUM, timeout = NUM");
		});

		it("sed with case insensitive flag", () => {
			const r = hedreplace("s/hello/world/gi", null, "Hello hello HELLO");
			assert.equal(r, "world world world");
		});

		it("sed search detects in content", () => {
			const r = hedsearch("s/3000/8080/", "port = 3000");
			assert.equal(r.found, true);
			assert.equal(r.match, "3000");
		});

		it("sed match checks for search text in string", () => {
			assert.equal(hedmatch("s/3000/8080/", "3000"), true);
			assert.equal(hedmatch("s/3000/8080/", "port = 3000"), true);
			assert.equal(hedmatch("s/3000/8080/", "no match"), false);
		});
	});
});

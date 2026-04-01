import assert from "node:assert/strict";
import { describe, it } from "node:test";
import langFor from "./langFor.js";

describe("langFor", () => {
	it("maps common JS extensions", () => {
		assert.equal(langFor("src/app.js"), "js");
		assert.equal(langFor("lib/module.mjs"), "js");
		assert.equal(langFor("old/thing.cjs"), "js");
		assert.equal(langFor("components/App.jsx"), "jsx");
	});

	it("maps TypeScript extensions", () => {
		assert.equal(langFor("index.ts"), "ts");
		assert.equal(langFor("Page.tsx"), "tsx");
	});

	it("maps systems languages", () => {
		assert.equal(langFor("main.go"), "go");
		assert.equal(langFor("lib.rs"), "rust");
		assert.equal(langFor("app.c"), "c");
		assert.equal(langFor("header.h"), "c");
		assert.equal(langFor("app.cpp"), "cpp");
		assert.equal(langFor("header.hpp"), "cpp");
	});

	it("maps scripting languages", () => {
		assert.equal(langFor("app.py"), "python");
		assert.equal(langFor("app.rb"), "ruby");
		assert.equal(langFor("script.lua"), "lua");
		assert.equal(langFor("app.php"), "php");
		assert.equal(langFor("analysis.r"), "r");
	});

	it("maps data/config formats", () => {
		assert.equal(langFor("data.json"), "json");
		assert.equal(langFor("config.yaml"), "yaml");
		assert.equal(langFor("config.yml"), "yaml");
		assert.equal(langFor("config.toml"), "toml");
		assert.equal(langFor("schema.xml"), "xml");
		assert.equal(langFor("page.html"), "html");
		assert.equal(langFor("style.css"), "css");
		assert.equal(langFor("readme.md"), "markdown");
		assert.equal(langFor("query.sql"), "sql");
	});

	it("maps other languages", () => {
		assert.equal(langFor("Main.java"), "java");
		assert.equal(langFor("App.kt"), "kotlin");
		assert.equal(langFor("Program.cs"), "csharp");
		assert.equal(langFor("App.swift"), "swift");
		assert.equal(langFor("deploy.sh"), "bash");
		assert.equal(langFor("setup.zsh"), "bash");
	});

	it("returns empty string for unknown extensions", () => {
		assert.equal(langFor("data.csv"), "");
		assert.equal(langFor("image.png"), "");
		assert.equal(langFor("Makefile"), "");
	});

	it("returns empty string for null/empty", () => {
		assert.equal(langFor(null), "");
		assert.equal(langFor(""), "");
		assert.equal(langFor(undefined), "");
	});

	it("handles nested paths", () => {
		assert.equal(langFor("src/deep/nested/file.ts"), "ts");
		assert.equal(langFor("a/b/c/d.py"), "python");
	});

	it("handles dotfiles and double extensions", () => {
		assert.equal(langFor(".gitignore"), "");
		assert.equal(langFor("file.test.js"), "js");
		assert.equal(langFor("schema.d.ts"), "ts");
	});
});

import assert from "node:assert";
import { describe, it } from "node:test";
import XmlParser from "./XmlParser.js";

describe("XmlParser", () => {
	it("parses summary", () => {
		const { commands } = XmlParser.parse(
			"<summary>The answer is 42.</summary>",
		);
		assert.strictEqual(commands.length, 1);
		assert.strictEqual(commands[0].name, "summary");
		assert.strictEqual(commands[0].value, "The answer is 42.");
	});

	it("parses unknown", () => {
		const { commands } = XmlParser.parse(
			"<unknown>which session store</unknown>",
		);
		assert.strictEqual(commands[0].name, "unknown");
		assert.strictEqual(commands[0].value, "which session store");
	});

	it("parses known with key", () => {
		const { commands } = XmlParser.parse(
			'<known key="/:known:auth">OAuth2 PKCE</known>',
		);
		assert.strictEqual(commands[0].name, "known");
		assert.strictEqual(commands[0].key, "/:known:auth");
		assert.strictEqual(commands[0].value, "OAuth2 PKCE");
	});

	it("parses self-closing read", () => {
		const { commands } = XmlParser.parse('<read key="src/config.js"/>');
		assert.strictEqual(commands[0].name, "read");
		assert.strictEqual(commands[0].key, "src/config.js");
	});

	it("parses self-closing drop", () => {
		const { commands } = XmlParser.parse('<drop key="/:unknown:42"/>');
		assert.strictEqual(commands[0].name, "drop");
		assert.strictEqual(commands[0].key, "/:unknown:42");
	});

	it("parses self-closing delete", () => {
		const { commands } = XmlParser.parse('<delete key="src/old.js"/>');
		assert.strictEqual(commands[0].name, "delete");
		assert.strictEqual(commands[0].key, "src/old.js");
	});

	it("parses run command", () => {
		const { commands } = XmlParser.parse('<run command="npm test"/>');
		assert.strictEqual(commands[0].name, "run");
		assert.strictEqual(commands[0].command, "npm test");
	});

	it("parses env command", () => {
		const { commands } = XmlParser.parse('<env command="ls -la src/"/>');
		assert.strictEqual(commands[0].name, "env");
		assert.strictEqual(commands[0].command, "ls -la src/");
	});

	it("parses ask_user", () => {
		const { commands } = XmlParser.parse(
			'<ask_user question="Which DB?" options="PG, SQLite"/>',
		);
		assert.strictEqual(commands[0].name, "ask_user");
		assert.strictEqual(commands[0].question, "Which DB?");
		assert.strictEqual(commands[0].options, "PG, SQLite");
	});

	it("parses edit with search/replace block", () => {
		const input = `<edit file="src/config.js">
<<<<<<< SEARCH
const port = 3000;
=======
const port = 8080;
>>>>>>> REPLACE
</edit>`;
		const { commands } = XmlParser.parse(input);
		assert.strictEqual(commands[0].name, "edit");
		assert.strictEqual(commands[0].file, "src/config.js");
		assert.strictEqual(commands[0].blocks.length, 1);
		assert.strictEqual(commands[0].blocks[0].search, "const port = 3000;");
		assert.strictEqual(commands[0].blocks[0].replace, "const port = 8080;");
	});

	it("parses edit with multiple merge blocks", () => {
		const input = `<edit file="src/config.js">
<<<<<<< SEARCH
const port = 3000;
=======
const port = 8080;
>>>>>>> REPLACE
<<<<<<< SEARCH
const host = "localhost";
=======
const host = "0.0.0.0";
>>>>>>> REPLACE
</edit>`;
		const { commands } = XmlParser.parse(input);
		assert.strictEqual(commands[0].blocks.length, 2);
		assert.strictEqual(
			commands[0].blocks[1].search,
			'const host = "localhost";',
		);
		assert.strictEqual(
			commands[0].blocks[1].replace,
			'const host = "0.0.0.0";',
		);
	});

	it("parses edit for new file (replace only)", () => {
		const input = `<edit file="src/new.js">
=======
export default {};
>>>>>>> REPLACE
</edit>`;
		const { commands } = XmlParser.parse(input);
		assert.strictEqual(commands[0].blocks.length, 1);
		assert.strictEqual(commands[0].blocks[0].search, null);
		assert.strictEqual(commands[0].blocks[0].replace, "export default {};");
	});

	it("parses multiple commands in one response", () => {
		const input = `<read key="src/config.js"/>
<unknown>which database adapter</unknown>
<known key="/:known:framework">Express with passport</known>
<summary>Reading config to check port.</summary>`;
		const { commands } = XmlParser.parse(input);
		assert.strictEqual(commands.length, 4);
		assert.strictEqual(commands[0].name, "read");
		assert.strictEqual(commands[1].name, "unknown");
		assert.strictEqual(commands[2].name, "known");
		assert.strictEqual(commands[3].name, "summary");
	});

	it("captures unparsed text", () => {
		const input = `Some thinking text here.
<summary>The answer.</summary>
More rambling.`;
		const { commands, unparsed } = XmlParser.parse(input);
		assert.strictEqual(commands.length, 1);
		assert.ok(unparsed.includes("Some thinking text here."));
		assert.ok(unparsed.includes("More rambling."));
	});

	it("handles empty content", () => {
		const { commands } = XmlParser.parse("");
		assert.strictEqual(commands.length, 0);
	});

	it("handles null content", () => {
		const { commands } = XmlParser.parse(null);
		assert.strictEqual(commands.length, 0);
	});
});

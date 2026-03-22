import assert from "node:assert";
import test from "node:test";
import { DOMParser } from "@xmldom/xmldom";
import Turn from "./Turn.js";

const xmlTemplate = `
    <turn sequence="1">
      <system>System prompt</system>
      <context>
        <files>
          <file path="a.js" size="100" tokens="50">
            <symbols>foo()	bar()</symbols>
            <source>console.log('hi');</source>
          </file>
        </files>
        <error protocol="violation">Test Error</error>
        <warn>Test Warn</warn>
        <info file="a.js">Test Info</info>
      </context>
      <user>user prompt</user>
      <assistant>
        <reasoning_content>reasoning...</reasoning_content>
        <content>assistant content</content>
        <tasks>- [x] Done\n- [ ] Pending</tasks>
        <known>known info</known>
        <unknown>unknown gaps</unknown>
        <summary>turn summary</summary>
        <meta>{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30,"alias":"m1","actualModel":"gpt-4"}</meta>
      </assistant>
    </turn>
`;

test("Turn class", async (t) => {
	const parser = new DOMParser();

	await t.test("constructor and doc getter", () => {
		const doc = parser.parseFromString("<turn/>", "text/xml");
		const turn = new Turn(doc);
		assert.strictEqual(turn.doc, doc);
	});

	await t.test("save() should persist elements to DB recursively", async () => {
		const doc = parser.parseFromString(
			'<turn sequence="1"><system>Hi</system><context><file path="a.js">content</file></context></turn>',
			"text/xml",
		);
		const elements = [];
		const mockDb = {
			insert_turn_element: {
				get: async (params) => {
					elements.push(params);
					return { id: elements.length };
				},
			},
			update_turn_payload: { run: async () => {} },
		};
		const turn = new Turn(doc, mockDb, 123);
		await turn.save();

		// Root, system, context, file
		assert.ok(elements.length >= 4);
		assert.strictEqual(elements[0].tag_name, "turn");
		assert.strictEqual(elements[1].tag_name, "system");
		assert.strictEqual(elements[1].content, "Hi");
	});

	await t.test("toJson()", () => {
		const doc = parser.parseFromString(xmlTemplate, "text/xml");
		const turn = new Turn(doc);
		const json = turn.toJson();

		assert.strictEqual(json.sequence, 1);
		assert.strictEqual(json.system, "System prompt");
		assert.strictEqual(json.user, "user prompt");
		assert.strictEqual(json.assistant.content, "assistant content");
		assert.strictEqual(json.assistant.reasoning, "reasoning...");

		assert.ok(Array.isArray(json.assistant.tasks), "Tasks should be an array");
		assert.strictEqual(json.assistant.tasks.length, 2);
		assert.strictEqual(json.assistant.tasks[0].completed, true);
		assert.strictEqual(json.assistant.tasks[1].text, "Pending");
		assert.strictEqual(json.assistant.tasks[1].completed, false);
		assert.strictEqual(json.assistant.next_task.text, "Pending");

		assert.strictEqual(json.assistant.known, "known info");
		assert.strictEqual(json.assistant.unknown, "unknown gaps");
		assert.strictEqual(json.assistant.summary, "turn summary");
		assert.strictEqual(json.usage.total_tokens, 30);
		assert.strictEqual(json.files.length, 1);
		assert.strictEqual(json.files[0].path, "a.js");

		assert.strictEqual(json.errors.length, 1);
		assert.strictEqual(json.errors[0].content, "Test Error");
		assert.strictEqual(json.errors[0].protocol, "violation");

		assert.strictEqual(json.warnings.length, 1);
		assert.strictEqual(json.warnings[0].content, "Test Warn");

		assert.strictEqual(json.infos.length, 1);
		assert.strictEqual(json.infos[0].content, "Test Info");
		assert.strictEqual(json.infos[0].file, "a.js");

		assert.strictEqual(json.files[0].symbols.length, 2);
		assert.strictEqual(json.files[0].symbols[0].name, "foo");
	});

	await t.test("toXml()", () => {
		const doc = parser.parseFromString(xmlTemplate, "text/xml");
		const turn = new Turn(doc);
		const xmlOutput = turn.toXml();
		assert.ok(xmlOutput.includes('<turn sequence="1">'));
		assert.ok(xmlOutput.includes("System prompt"));
	});

	await t.test("serialize()", async () => {
		const doc = parser.parseFromString(xmlTemplate, "text/xml");
		const turn = new Turn(doc);
		const msgs = await turn.serialize();
		assert.strictEqual(msgs.length, 3);
		assert.strictEqual(msgs[0].role, "system");
		assert.strictEqual(msgs[1].role, "user");
		assert.strictEqual(msgs[2].role, "assistant");
	});
});

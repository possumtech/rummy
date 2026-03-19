import { strictEqual, ok, deepStrictEqual } from "node:assert";
import { describe, it } from "node:test";
import { DOMImplementation } from "@xmldom/xmldom";
import Turn from "./Turn.js";

describe("Turn", () => {
	const dom = new DOMImplementation();
	const createDoc = () => {
		const doc = dom.createDocument(null, "turn", null);
		const root = doc.documentElement;
		root.setAttribute("sequence", "1");

		const system = doc.createElement("system");
		system.appendChild(doc.createTextNode("system prompt"));
		root.appendChild(system);

		const context = doc.createElement("context");
		const file = doc.createElement("file");
		file.setAttribute("path", "test.js");
		file.setAttribute("status", "active");
		const source = doc.createElement("source");
		source.appendChild(doc.createTextNode("console.log('hi');"));
		file.appendChild(source);
		context.appendChild(file);
		root.appendChild(context);

		const user = doc.createElement("user");
		user.appendChild(doc.createTextNode("user prompt"));
		root.appendChild(user);

		const assistant = doc.createElement("assistant");
		const content = doc.createElement("content");
		content.appendChild(doc.createTextNode("assistant response"));
		assistant.appendChild(content);
		const meta = doc.createElement("meta");
		meta.appendChild(doc.createTextNode(JSON.stringify({ usage: { total_tokens: 100 } })));
		assistant.appendChild(meta);
		root.appendChild(assistant);

		return doc;
	};

	it("should serialize to OpenAI messages format", async () => {
		const turn = new Turn(createDoc());
		const messages = await turn.serialize();

		strictEqual(messages.length, 2);
		strictEqual(messages[0].role, "system");
		ok(messages[0].content.includes("system prompt"));
		strictEqual(messages[1].role, "user");
		ok(messages[1].content.includes("user prompt"));
	});

	it("should serialize to JSON format for the client", () => {
		const turn = new Turn(createDoc());
		const json = turn.toJson();

		strictEqual(json.sequence, 1);
		strictEqual(json.system, "system prompt");
		strictEqual(json.user, "user prompt");
		strictEqual(json.assistant.content, "assistant response");
		strictEqual(json.usage.total_tokens, 100);
		strictEqual(json.files.length, 1);
		strictEqual(json.files[0].path, "test.js");
		strictEqual(json.files[0].content, "console.log('hi');");
	});

	it("should serialize to XML format", () => {
		const turn = new Turn(createDoc());
		const xml = turn.toXml();

		ok(xml.includes("<turn sequence=\"1\">"));
		ok(xml.includes("system prompt"));
		ok(xml.includes("<user"));
		ok(xml.includes("user prompt"));
	});

	it("should provide helpers for assistant section", () => {
		const turn = new Turn(createDoc());
		turn.assistant.reasoning.add("reasoning...");
		
		const json = turn.toJson();
		strictEqual(json.assistant.reasoning, "reasoning...");
	});
});

import assert from "node:assert";
import { describe, it } from "node:test";
import { DOMImplementation } from "@xmldom/xmldom";
import Turn from "./Turn.js";

describe("Turn (DOM)", () => {
	it("should serialize to OpenAI messages", async () => {
		const dom = new DOMImplementation();
		const doc = dom.createDocument(null, "turn", null);
		const system = doc.createElement("system");
		const user = doc.createElement("user");
		const ask = doc.createElement("ask");

		system.appendChild(doc.createTextNode("Instructions"));
		ask.appendChild(doc.createTextNode("Question"));
		user.appendChild(ask);

		doc.documentElement.appendChild(system);
		doc.documentElement.appendChild(user);

		const turn = new Turn(doc);
		const messages = await turn.serialize();

		assert.strictEqual(messages.length, 2);
		assert.ok(messages[0].content.includes("Instructions"));
		assert.ok(messages[1].content.includes("Question"));
	});
});

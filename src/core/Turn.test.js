import assert from "node:assert";
import { describe, it } from "node:test";
import Turn from "./Turn.js";

describe("Turn", () => {
	it("should serialize to OpenAI messages with XML tags and file status", () => {
		const turn = new Turn();
		turn.system.content.add("System instructions", 10);
		turn.user.prompt.add("User question", 10);
		turn.context.files.add(
			{ path: "f1.js", content: "code", status: "active" },
			10,
		);
		turn.context.files.add(
			{ path: "f2.js", symbols: [{ name: "sym" }], mode: "hot" },
			20,
		);

		const messages = turn.serialize();
		const sys = messages[0].content;

		assert.ok(/<file path="f1.js" status="active">/.test(sys));
		assert.ok(/code/.test(sys));
		assert.ok(/<file path="f2.js" status="hot">/.test(sys));
	});

	it("should serialize full turn including assistant reasoning and meta", () => {
		const turn = new Turn();
		turn.system.content.add("sys", 10);
		turn.assistant.reasoning.add("Thinking...", 10);
		turn.assistant.content.add("Response", 10);
		turn.assistant.meta.add({ tokens: 10 }, 10);

		const xml = turn.toXml();
		assert.ok(xml.includes("<reasoning_content>"));
		assert.ok(xml.includes("Thinking..."));
		assert.ok(xml.includes("<content>"));
		assert.ok(xml.includes("Response"));
		assert.ok(xml.includes("<meta>"));
		assert.ok(xml.includes('"tokens": 10'));
	});

	it("should NOT include empty sections or empty symbol tags", () => {
		const turn = new Turn();
		turn.system.content.add("System", 10);
		turn.user.prompt.add("User", 10);

		// File with empty symbols
		turn.context.files.add({ path: "empty.js", symbols: [] }, 10);

		const messages = turn.serialize();
		const sys = messages[0].content;

		assert.ok(
			!sys.includes("<symbols>"),
			"Should NOT contain empty symbols tag",
		);
		assert.ok(
			!sys.includes("<git_changes>"),
			"Should NOT contain empty git section",
		);
		assert.ok(
			sys.includes('<file path="empty.js" status="unknown" />'),
			"Should use self-closing tag for empty file",
		);
	});

	it("should NOT include whole sections if they are empty", () => {
		const turn = new Turn();
		turn.user.prompt.add("Only User", 10);

		const messages = turn.serialize();
		// System role should be empty string
		assert.strictEqual(messages[0].content, "");
		assert.ok(messages[1].content.includes("<user>"));
	});
});

import assert from "node:assert";
import { describe, it } from "node:test";
import Turn from "./Turn.js";

describe("Turn", () => {
	it("should serialize to OpenAI messages with XML tags", () => {
		const turn = new Turn();
		turn.system.content.add("System instructions", 10);
		turn.context.gitChanges.add("Some diff", 10);
		turn.user.prompt.add("User question", 10);
		turn.context.files.add({ path: "f1.js", content: "code" }, 10);
		turn.context.files.add({ path: "f2.js", symbols: [{ name: "sym" }] }, 20);

		const messages = turn.serialize();

		assert.strictEqual(messages.length, 2);
		assert.strictEqual(messages[0].role, "system");
		assert.strictEqual(messages[1].role, "user");

		const sys = messages[0].content;
		assert.ok(sys.includes("<system>\nSystem instructions\n</system>"));
		assert.ok(sys.includes("<context>"));
		assert.ok(sys.includes('<file path="f1.js">code</file>'));
		assert.ok(sys.includes('<symbols>[{"name":"sym"}]</symbols>'));
		assert.ok(sys.includes("<git_changes>\nSome diff\n</git_changes>"));

		const user = messages[1].content;
		assert.ok(user.includes("<user>"));
		assert.ok(user.includes("<ask>\nUser question\n</ask>"));
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
			sys.includes('<file path="empty.js" />'),
			"Should use self-closing tag for empty file",
		);
	});

	it("should NOT include whole sections if they are empty", () => {
		const turn = new Turn();
		turn.user.prompt.add("Only User", 10);

		const messages = turn.serialize();
		assert.strictEqual(
			messages[0].content,
			"",
			"System message should be empty if no system/context content",
		);
		assert.ok(messages[1].content.includes("<user>"));
	});
});

import assert from "node:assert";
import { describe, it } from "node:test";
import Turn from "./Turn.js";

describe("Turn", () => {
	it("should serialize to OpenAI messages with XML tags", () => {
		const turn = new Turn();
		turn.system.content.add("System instructions", 10);
		turn.context.gitChanges.add("Some diff", 10);
		turn.context.errors.add("Error 1", 10);
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
		assert.ok(sys.includes("<error>Error 1</error>"));

		const user = messages[1].content;
		assert.ok(user.includes("<user>"));
		assert.ok(user.includes("<ask>\nUser question\n</ask>"));
	});
});

import assert from "node:assert";
import test from "node:test";
import TaskParser from "./TaskParser.js";

test("TaskParser", async (t) => {
	await t.test("should parse markdown checkbox lists", () => {
		const text = `
- [x] Completed task
- [ ] Pending task
* [ ] Another pending
- Just a line
`;
		const { list, next } = TaskParser.parse(text);

		assert.strictEqual(list.length, 4);
		assert.strictEqual(list[0].text, "Completed task");
		assert.strictEqual(list[0].completed, true);
		assert.strictEqual(list[1].text, "Pending task");
		assert.strictEqual(list[1].completed, false);

		assert.ok(next, "Should have a next task");
		assert.strictEqual(next.text, "Pending task");
	});

	await t.test("should handle empty input", () => {
		const { list, next } = TaskParser.parse("");
		assert.strictEqual(list.length, 0);
		assert.strictEqual(next, null);
	});

	await t.test("should handle all completed tasks", () => {
		const text = "- [x] Done\n- [X] Also Done";
		const { list, next } = TaskParser.parse(text);
		assert.strictEqual(
			list.every((t) => t.completed),
			true,
		);
		assert.strictEqual(next, null);
	});
});

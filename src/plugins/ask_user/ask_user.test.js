import assert from "node:assert/strict";
import { describe, it } from "node:test";
import AskUser from "./ask_user.js";

describe("AskUser", () => {
	const plugin = new AskUser({
		registerScheme() {},
		on() {},
		filter() {},
	});

	it("full tab-indents the body (empty for self-closing ask_user)", () => {
		const result = plugin.full({
			attributes: { question: "What color?", options: "red;blue" },
			body: "",
		});
		assert.equal(result, "");
	});

	it("summary tab-indents the rendered Q→A line", () => {
		assert.strictEqual(
			plugin.summary({ attributes: { question: "What?", answer: "Yes" } }),
			"\tWhat? → Yes",
		);
	});

	it("summary caps question and answer separately, preserves arrow", () => {
		const longQ = "Q".repeat(1000);
		const longA = "A".repeat(1000);
		const out = plugin.summary({
			attributes: { question: longQ, answer: longA },
		});
		assert.ok(
			out.includes(" → "),
			"arrow separator survives even on huge inputs",
		);
		const [head, tail] = out.split(" → ");
		assert.ok(head.length < longQ.length, "question side capped");
		assert.ok(tail.length < longA.length, "answer side capped");
		assert.ok(head.length > 0 && tail.length > 0, "both sides non-empty");
	});
});

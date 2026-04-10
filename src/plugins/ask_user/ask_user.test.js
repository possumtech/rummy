import assert from "node:assert/strict";
import { describe, it } from "node:test";
import AskUser from "./ask_user.js";

describe("AskUser", () => {
	const plugin = new AskUser({
		registerScheme() {},
		on() {},
		filter() {},
	});

	it("full renders question", () => {
		const result = plugin.full({
			attributes: { question: "What color?", options: "red;blue" },
			body: "",
		});
		assert.ok(result.includes("What color?"));
	});

	it("summary renders question and answer", () => {
		assert.strictEqual(
			plugin.summary({ attributes: { question: "What?", answer: "Yes" } }),
			"What? → Yes",
		);
	});
});

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
});

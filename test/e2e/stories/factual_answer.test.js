/**
 * User story: ask a factual question whose answer is in a project file.
 *
 * The model should answer from context without micro-management. No
 * tool calls strictly required if the file content fits — the model
 * recognizes the answer is already on hand.
 */
import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import StoryHarness from "../../helpers/StoryHarness.js";

const TIMEOUT = 480_000;

describe("Story: factual answer from project context (@resolution)", () => {
	const story = new StoryHarness("factual_answer");

	before(() => story.setUp());
	after(() => story.tearDown());

	it("user asks for the codename in notes.md, model replies with it", {
		timeout: TIMEOUT,
	}, async () => {
		const r = await story.ask(
			"What is the project codename in notes.md? Reply ONLY with the word.",
			{ noInteraction: true },
		);
		await story.client.assertRun(r, 200, "factual");
		const answer = await story.lastResponse(r.run);
		assert.match(
			answer.toLowerCase(),
			/phoenix/,
			`expected "phoenix" in response, got: "${answer.slice(0, 200)}"`,
		);
	});
});

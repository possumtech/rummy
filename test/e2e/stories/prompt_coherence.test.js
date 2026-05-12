/**
 * User story: multiple follow-up questions on the same run. The model
 * must answer the LATEST question, not an earlier one.
 *
 * Catches the failure mode where the model carries an old shape-rule
 * across loops and answers the wrong question.
 */
import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import StoryHarness from "../../helpers/StoryHarness.js";

const TIMEOUT = 480_000;

describe("Story: prompt coherence across follow-up questions (@resolution)", () => {
	const story = new StoryHarness("prompt_coherence");

	before(() => story.setUp());
	after(() => story.tearDown());

	it("two distinct questions on one run, each answered correctly", {
		timeout: TIMEOUT,
	}, async () => {
		const r1 = await story.ask(
			"What is the project codename in notes.md? Reply ONLY with the word.",
			{ noInteraction: true },
		);
		await story.client.assertRun(r1, 200, "coherence-1");
		const a1 = await story.lastResponse(r1.run);
		assert.match(
			a1.toLowerCase(),
			/phoenix/,
			`coherence-1: expected "phoenix", got: "${a1.slice(0, 200)}"`,
		);

		const r2 = await story.ask(
			"How many users are in data/users.json? Reply ONLY with the number.",
			{ run: r1.run, noInteraction: true },
		);
		await story.client.assertRun(r2, 200, "coherence-2");
		const a2 = await story.lastResponse(r2.run);
		assert.match(
			a2,
			/2/,
			`coherence-2: expected "2", got: "${a2.slice(0, 200)}"`,
		);
	});
});

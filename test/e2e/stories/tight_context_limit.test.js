/**
 * User story: ask a question under a tight context ceiling. The model
 * must manage visibility (archive what it doesn't need, fetch only
 * what it does) to fit the answer's source file alongside the system
 * prompt + scaffolding.
 *
 * If the budget machinery can't recover under pressure, the run
 * terminates 499 (Loop detected) instead of reaching the answer.
 */
import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import StoryHarness from "../../helpers/StoryHarness.js";

const TIMEOUT = 480_000;

describe("Story: model answers correctly under tight context (@budget_enforcement)", () => {
	const story = new StoryHarness("tight_context_limit");

	before(() => story.setUp());
	after(() => story.tearDown());

	it("user asks the codename question with contextLimit=7000; model still answers", {
		timeout: TIMEOUT,
	}, async () => {
		const r = await story.ask(
			"What is the project codename in notes.md? Reply ONLY with the word.",
			{ noInteraction: true, contextLimit: 7000 },
		);
		await story.client.assertRun(r, 200, "tight-context");
		const answer = await story.lastResponse(r.run);
		assert.match(
			answer.toLowerCase(),
			/phoenix/,
			`expected "phoenix", got: "${answer.slice(0, 200)}"`,
		);
	});
});

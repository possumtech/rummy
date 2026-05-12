/**
 * User story: lite mode (noRepo: true) skips project file ingestion.
 * The model remembers facts from prior turns of the same run without
 * any project context.
 *
 * First prompt is a bare statement so the model doesn't carry a
 * shape-rule into the next loop; second prompt is the only
 * shape-constrained turn so recall alone is what's being tested.
 */
import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import StoryHarness from "../../helpers/StoryHarness.js";

const TIMEOUT = 480_000;

describe("Story: lite-mode sustained session (@resolution)", () => {
	const story = new StoryHarness("lite_mode_sustained");

	before(() => story.setUp());
	after(() => story.tearDown());

	it("model remembers a fact stated on a prior turn", {
		timeout: TIMEOUT,
	}, async () => {
		const r1 = await story.ask("My account number is 42.", {
			noRepo: true,
			noInteraction: true,
		});
		await story.client.assertRun(r1, 200, "lite-1");

		const r2 = await story.ask(
			"What is my account number? Reply with just the digits.",
			{ run: r1.run, noInteraction: true },
		);
		await story.client.assertRun(r2, 200, "lite-2");
		const answer = await story.lastResponse(r2.run);
		assert.match(answer, /42/, `expected "42", got: "${answer.slice(0, 200)}"`);
	});
});

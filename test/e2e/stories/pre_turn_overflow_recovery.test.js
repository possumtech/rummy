/**
 * User story: under a tight contextLimit, the pre-turn budget guard
 * must intercept overflow before a 413 reaches the client.
 *
 * Acceptable terminals: 200 (recovery succeeded), 202 (proposed), 499
 * (recovery insufficient → strike fired cleanly). What's NOT
 * acceptable: a raw 413 leaking to the client — that means the
 * pre-LLM budget guard didn't run at all.
 */
import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import StoryHarness from "../../helpers/StoryHarness.js";

const TIMEOUT = 480_000;

describe("Story: pre-turn overflow triggers recovery, not raw 413 (@budget_enforcement)", () => {
	const story = new StoryHarness("pre_turn_overflow_recovery");

	before(() => story.setUp());
	after(() => story.tearDown());

	it("tight ceiling on a 5-known save + summarize never leaks 413", {
		timeout: TIMEOUT,
	}, async () => {
		const r1 = await story.ask(
			"Save 5 separate known entries about colors: red is warm, blue is cool, green is nature, yellow is bright, purple is royal. Then summarize.",
			{ noInteraction: true, noRepo: true, contextLimit: 4500 },
		);
		assert.ok(
			[200, 202, 499].includes(r1.status),
			`setup: expected terminal status, got ${r1.status}`,
		);

		const r2 = await story.ask("What color is associated with royalty?", {
			run: r1.run,
			noInteraction: true,
			noRepo: true,
		});

		assert.notStrictEqual(
			r2.status,
			413,
			"raw 413 should never reach the client — pre-LLM budget guard must intercept",
		);
		assert.ok(
			[200, 202, 499].includes(r2.status),
			`expected terminal status from a valid recovery path, got ${r2.status}`,
		);
	});
});

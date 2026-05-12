/**
 * User story: model writes new entries that push context over the
 * ceiling. Turn Demotion fires, keeps context under ceiling, run
 * completes or strikes cleanly — never leaks a raw 413.
 */
import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import StoryHarness from "../../helpers/StoryHarness.js";

const TIMEOUT = 480_000;

describe("Story: turn demotion fires on tight context, run continues (@budget_enforcement)", () => {
	const story = new StoryHarness("turn_demotion");

	before(() => story.setUp());
	after(() => story.tearDown());

	it("3-known save + summarize under contextLimit=5000 never leaks 413", {
		timeout: TIMEOUT,
	}, async () => {
		const r = await story.ask(
			"Save 3 known entries: known://colors/warm with body 'red orange yellow', known://colors/cool with body 'blue green teal', known://colors/neutral with body 'gray white black'. Then summarize.",
			{ noInteraction: true, noRepo: true, contextLimit: 5000 },
		);

		assert.notStrictEqual(
			r.status,
			413,
			"raw 413 should never reach the client — Turn Demotion guard must intercept",
		);
		assert.ok(
			[200, 202, 499].includes(r.status),
			`expected terminal status, got ${r.status}`,
		);
	});
});

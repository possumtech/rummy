/**
 * User story: ask the model to research something on the web and
 * remember it.
 *
 * Model should search, distill a fact, save it as a known entry, and
 * report the answer in one autonomous run.
 */
import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import StoryHarness from "../../helpers/StoryHarness.js";

const TIMEOUT = 480_000;

describe("Story: autonomous web research + knowledge save (@resolution)", () => {
	const story = new StoryHarness("autonomous_research");

	before(() => story.setUp());
	after(() => story.tearDown());

	it("user asks for a fact on the web, model searches and saves it", {
		timeout: TIMEOUT,
	}, async () => {
		const r = await story.ask(
			"Search the web for when Mass Effect 1 was released. Save the release year as a known entry. Tell me the year.",
			{ noInteraction: true },
		);
		await story.client.assertRun(r, 200, "research");
		const answer = await story.lastResponse(r.run);
		assert.match(
			answer,
			/2007/,
			`expected "2007" in response, got: "${answer.slice(0, 200)}"`,
		);

		const entries = await story.allEntries(r.run);
		const searched = entries.filter((e) =>
			/^log:\/\/\d+\/\d+\/\d+\/search$/.test(e.path),
		);
		assert.ok(searched.length > 0, "should have performed a web search");
		const known = entries.filter((e) => e.scheme === "known");
		assert.ok(known.length > 0, "should have saved discovered knowledge");
	});
});

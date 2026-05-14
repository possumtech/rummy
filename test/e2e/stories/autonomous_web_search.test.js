/**
 * User story: search the web for a fact and report it. Search logs
 * carry a JSON-per-row result manifest (`{"path":"...","tokens":N}`)
 * matching the rest of the catalog shape so the model parses with
 * one primitive.
 */
import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import StoryHarness from "../../helpers/StoryHarness.js";

const TIMEOUT = 480_000;

describe("Story: autonomous web search returns the fact (@resolution)", () => {
	const story = new StoryHarness("autonomous_web_search");

	before(() => story.setUp());
	after(() => story.tearDown());

	it("user asks a date question on the web; model searches and answers", {
		timeout: TIMEOUT,
	}, async () => {
		const r = await story.ask(
			'Search the web for "Mitch Hedberg death date" and tell me when he died. Limit search results to 3.',
			{ noInteraction: true, noRepo: true },
		);
		await story.client.assertRun(r, 200, "search");
		const answer = await story.lastResponse(r.run);
		assert.match(
			answer,
			/2005/,
			`expected "2005", got: "${answer.slice(0, 200)}"`,
		);

		const entries = await story.allEntries(r.run);
		const searchLogs = entries.filter(
			(e) => e.scheme === "log" && /\/search$/.test(e.path),
		);
		assert.ok(searchLogs.length > 0, "search produced at least one log entry");
		// Row shape: `{"path":"https://...", ...optional fields..., "tokens":N, "lines":M}`.
		// rummy.web inserts `title` between path and tokens; assertion is
		// flexible about intermediate fields so adding/removing optional
		// row keys doesn't break the test.
		assert.ok(
			searchLogs.some((e) =>
				/\{"path":"https?:\/\/[^"]+",.*"tokens":\d+,.*"lines":\d+/.test(e.body),
			),
			"at least one search log body lists results as JSON-per-row manifest",
		);
	});
});

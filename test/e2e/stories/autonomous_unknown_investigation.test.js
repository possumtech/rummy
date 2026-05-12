/**
 * User story: multi-hop investigation. Model decomposes the question
 * into unknowns, finds them, and reports.
 *
 * Prompt is scoped to exactly two values so the Decomposition stage
 * has a clear stopping point — earlier open-ended phrasings let the
 * model over-define adjacent unknowns and stall on Completion.
 */
import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import StoryHarness from "../../helpers/StoryHarness.js";

const TIMEOUT = 480_000;

describe("Story: autonomous multi-hop investigation (@resolution)", () => {
	const story = new StoryHarness("autonomous_unknown_investigation");

	before(() => story.setUp());
	after(() => story.tearDown());

	it("user asks for two values from config; model finds and reports them", {
		timeout: TIMEOUT,
	}, async () => {
		const r = await story.ask(
			"Find exactly two values in this project: the database connection pool size, and the database host. Answer with just those two values when you have them. Do not investigate any other database settings.",
			{ noInteraction: true },
		);
		await story.client.assertRun(r, [200, 202], "unknowns");
		const response = await story.lastResponse(r.run);
		assert.match(
			response,
			/5/,
			`pool size expected, got: "${response.slice(0, 200)}"`,
		);
		assert.match(
			response,
			/db\.internal/,
			`host expected, got: "${response.slice(0, 200)}"`,
		);
	});
});

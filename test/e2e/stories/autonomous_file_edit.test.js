/**
 * User story: ask the model to edit a file. With yolo mode the model
 * proposes the edit and the engine auto-accepts; the run produces a
 * write log entry.
 */
import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import StoryHarness from "../../helpers/StoryHarness.js";

const TIMEOUT = 480_000;

describe("Story: autonomous file edit under yolo (@resolution)", () => {
	const story = new StoryHarness("autonomous_file_edit");

	before(() => story.setUp());
	after(() => story.tearDown());

	it("model reads, edits, and writes the file in one run", {
		timeout: TIMEOUT,
	}, async () => {
		const r = await story.act(
			'In src/app.js, replace the TODO comment with "// error handler configured". Read the file first to find the exact text, then emit a udiff edit.',
			{ yolo: true },
		);
		await story.client.assertRun(r, [200, 202], "edit");

		const entries = await story.allEntries(r.run);
		const writes = entries.filter(
			(e) =>
				/^log:\/\/\d+\/\d+\/\d+\/set$/.test(e.path) &&
				(e.state === "resolved" || e.state === "proposed"),
		);
		assert.ok(writes.length > 0, "should have a write result");
	});
});

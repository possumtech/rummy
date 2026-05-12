/**
 * User story: after the model edits a file and the user accepts, the
 * next turn must see the new content. Stale reads break the trust
 * contract — if the scanner doesn't pick up the disk write, the
 * model answers from pre-edit state.
 *
 * Verifies the FileScanner external-mutation injection path.
 */
import assert from "node:assert";
import fs from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import StoryHarness from "../../helpers/StoryHarness.js";

const TIMEOUT = 480_000;

describe("Story: accepted file edit is visible on next turn (@filesystem_freshness)", () => {
	const story = new StoryHarness("accepted_edits_visible");

	before(() => story.setUp());
	after(() => story.tearDown());

	it("model edits file, run completes, follow-up turn quotes new content", {
		timeout: TIMEOUT,
	}, async () => {
		const r1 = await story.act(
			'In src/app.js, replace the TODO comment with "// error handler configured". Read the file first to find the exact text, then use SEARCH/REPLACE.',
			{ yolo: true },
		);
		await story.client.assertRun(r1, [200, 202], "edit");

		const fileContent = await fs.readFile(
			join(story.projectRoot, "src/app.js"),
			"utf8",
		);
		assert.ok(
			fileContent.includes("error handler configured"),
			`file should contain edit, got: ${fileContent.slice(0, 200)}`,
		);

		// Recitation forces an actual file read — can't be answered from
		// prior-loop knowns. If the scanner missed the disk write, the
		// model quotes the old TODO line instead.
		const r2 = await story.ask(
			"Quote the comment line in src/app.js verbatim. Just the line, no other text.",
			{ run: r1.run, noInteraction: true },
		);
		await story.client.assertRun(r2, 200, "edit-verify");
		const answer = await story.lastResponse(r2.run);
		assert.match(
			answer.toLowerCase(),
			/error handler configured/,
			`expected new edit visible, got: "${answer.slice(0, 200)}"`,
		);
	});
});

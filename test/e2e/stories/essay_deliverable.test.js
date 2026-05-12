/**
 * User story: user asks the model to write a multi-page essay to a
 * specific file. With yolo auto-acceptance, the run completes and the
 * file lands on disk.
 *
 * This is the gemma/demo prompt — the canonical end-to-end "Rummy
 * lets the LLM modify files" proof.
 */
import assert from "node:assert";
import fs from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import StoryHarness from "../../helpers/StoryHarness.js";

const TIMEOUT = 480_000;

describe("Story: model writes a multi-page essay to a file (@resolution, @run_state_machine)", () => {
	const story = new StoryHarness("essay_deliverable");

	before(() => story.setUp());
	after(() => story.tearDown());

	it("user asks for essay on Rumsfeld → run completes, file on disk", {
		timeout: TIMEOUT,
	}, async () => {
		const r = await story.act(
			"Provide a three page essay on the life and achievements of Donald Rumsfeld. Write the essay to RUMSFELD.md.",
			{ yolo: true },
		);
		await story.client.assertRun(r, [200, 202], "essay-terminal");

		const onDisk = await fs
			.readFile(join(story.projectRoot, "RUMSFELD.md"), "utf8")
			.catch(() => null);
		assert.ok(onDisk, "RUMSFELD.md exists on disk after yolo run");
		assert.ok(
			onDisk.length > 500,
			`essay has substantial content, got ${onDisk?.length} bytes`,
		);
		assert.match(
			onDisk.toLowerCase(),
			/rumsfeld/,
			"essay mentions the subject",
		);
	});
});

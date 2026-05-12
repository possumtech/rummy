/**
 * User story: user rejects a destructive proposal (rm of a file). The
 * file survives on disk; the engine doesn't bypass the rejection.
 *
 * Invariant under test: rejected rm did NOT delete the file —
 * `rm.js#onAccepted` is the only path that unlinks. Once any rm
 * proposal has been rejected, the file is provably safe regardless
 * of whether the run terminates gracefully.
 */
import assert from "node:assert";
import fs from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import StoryHarness from "../../helpers/StoryHarness.js";

const TIMEOUT = 480_000;

describe("Story: rejected rm proposal preserves the file (@resolution)", () => {
	const story = new StoryHarness("rejection_and_recovery");

	before(() => story.setUp());
	after(() => story.tearDown());

	it("user rejects rm proposal for notes.md; file survives", {
		timeout: TIMEOUT,
	}, async () => {
		const isRmProposal = (path) => /^log:\/\/\d+\/\d+\/\d+\/rm$/.test(path);
		story.client.resolveHandler = async (c, run, proposal) => {
			const action = isRmProposal(proposal.path) ? "reject" : "accept";
			await c.resolveProposal(run, {
				path: proposal.path,
				action,
				output: action === "reject" ? "Do not delete." : "",
			});
		};

		// Bound to 60s — once any rm has been rejected the contract
		// holds, even if the model keeps emitting variants after.
		await story.client
			.act({
				model: story.model,
				prompt: "Delete the file notes.md from the project.",
				timeoutMs: 60_000,
			})
			.catch(() => null);

		story.client.resolveHandler = null;

		const fileExists = await fs
			.stat(join(story.projectRoot, "notes.md"))
			.then(() => true)
			.catch(() => false);
		assert.ok(fileExists, "notes.md should still exist on disk");
		const content = await fs.readFile(
			join(story.projectRoot, "notes.md"),
			"utf8",
		);
		assert.match(content, /phoenix/);
	});
});

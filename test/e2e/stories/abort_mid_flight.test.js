/**
 * User story: user aborts a long-running task. The run reaches a
 * terminal status (499 cancelled, 200 if it completed in time, or 500
 * on a clean failure) — never stuck at 102 running.
 */
import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import StoryHarness from "../../helpers/StoryHarness.js";

const TIMEOUT = 480_000;

describe("Story: abort mid-flight reaches a terminal status (@run_state_machine)", () => {
	const story = new StoryHarness("abort_mid_flight");

	before(() => story.setUp());
	after(() => story.tearDown());

	it("user aborts a slow run, status becomes terminal — never stuck at 102", {
		timeout: TIMEOUT,
	}, async () => {
		let runAlias = null;
		const captureRun = (p) => {
			runAlias ??= p.run;
		};
		story.client.on("run/changed", captureRun);

		const askPromise = story.ask(
			"Carefully analyze every file in this project. Write a 500-word summary of each one. Then cross-reference all summaries.",
		);

		const deadline = Date.now() + 15_000;
		while (!runAlias && Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 500));
		}

		if (runAlias) {
			await story.client.abortRun(runAlias);
		}

		const result = await askPromise;
		assert.ok(
			[499, 200, 500].includes(result.status),
			`expected terminal status, got ${result.status}`,
		);

		if (runAlias) {
			const runRow = await story.tdb.db.get_run_by_alias.get({
				alias: runAlias,
			});
			assert.ok(runRow.status !== 102, "run should not be stuck at running");
		}

		story.client.removeListener("run/changed", captureRun);
	});
});

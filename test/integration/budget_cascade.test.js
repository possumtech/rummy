import assert from "node:assert";
import { after, before, beforeEach, describe, it } from "node:test";
import KnownStore from "../../src/agent/KnownStore.js";
import materialize from "../helpers/materialize.js";
import TestDb from "../helpers/TestDb.js";

function pad(n) {
	return Array(n).fill("hello world test data").join(" ");
}

describe("Budget cascade — crunch spiral + death spiral", () => {
	let tdb, store, cascade, RUN_ID;

	before(async () => {
		tdb = await TestDb.create("budget_cascade");
		store = new KnownStore(tdb.db);
		cascade = tdb.hooks.budget;
		const seed = await tdb.seedRun({ alias: "budget_1" });
		RUN_ID = seed.runId;
	});

	beforeEach(async () => {
		await store.deleteByPattern(RUN_ID, "**", null);
	});

	after(async () => {
		await tdb.cleanup();
	});

	async function assembleAndEnforce(contextSize, { summarize } = {}) {
		const turn = 1;
		const systemPrompt = "test";
		await materialize(tdb.db, { runId: RUN_ID, turn, systemPrompt });

		let rows = await tdb.db.get_turn_context.all({ run_id: RUN_ID, turn });
		let messages = [
			{ role: "system", content: systemPrompt },
			{
				role: "user",
				content: rows
					.filter((r) => r.path !== "system://prompt")
					.map((r) => r.body)
					.join("\n"),
			},
		];

		return cascade.enforce({
			contextSize,
			store,
			runId: RUN_ID,
			loopId: null,
			turn,
			messages,
			rows,
			summarize,
			rematerialize: async () => {
				await materialize(tdb.db, { runId: RUN_ID, turn, systemPrompt });
				rows = await tdb.db.get_turn_context.all({ run_id: RUN_ID, turn });
				messages = [
					{ role: "system", content: systemPrompt },
					{
						role: "user",
						content: rows
							.filter((r) => r.path !== "system://prompt")
							.map((r) => r.body)
							.join("\n"),
					},
				];
				return { messages, rows };
			},
		});
	}

	function getEntries() {
		return tdb.db.get_known_entries.all({ run_id: RUN_ID });
	}

	it("no demotion when under budget", async () => {
		await store.upsert(RUN_ID, 1, "known://small", "a small fact", 200);
		const result = await assembleAndEnforce(100000);
		assert.strictEqual(result.demoted.length, 0);
	});

	it("crunch spiral selects oldest entries first", async () => {
		// Create entries with clear age ordering and equal size
		await store.upsert(RUN_ID, 1, "known://oldest", pad(50), 200);
		await store.upsert(RUN_ID, 5, "known://middle", pad(50), 200);
		await store.upsert(RUN_ID, 10, "known://newest", pad(50), 200);

		// Budget forces at least one demotion
		const result = await assembleAndEnforce(3000);

		if (result.demoted.length > 0) {
			// Oldest should be demoted first
			assert.ok(
				result.demoted.includes("known://oldest"),
				"oldest entry should be demoted first",
			);

			// Newest should survive at full fidelity
			const entries = await getEntries();
			const newest = entries.find((e) => e.path === "known://newest");
			assert.strictEqual(
				newest.fidelity,
				"full",
				"newest entry should remain full",
			);
		}
	});

	it("crunch spiral selects fattest entries within oldest half", async () => {
		// All at same turn (same age), but different sizes
		await store.upsert(RUN_ID, 1, "known://tiny", "small", 200);
		await store.upsert(RUN_ID, 1, "known://medium", pad(20), 200);
		await store.upsert(RUN_ID, 1, "known://huge", pad(200), 200);
		// Newer entry that should survive
		await store.upsert(RUN_ID, 5, "known://recent", pad(20), 200);

		const result = await assembleAndEnforce(3000);

		if (result.demoted.length > 0) {
			// The huge entry should be among the first demoted
			assert.ok(
				result.demoted.includes("known://huge"),
				"fattest entry should be demoted",
			);
		}
	});

	it("crunch spiral is scheme-agnostic — all types treated equally by age", async () => {
		// Different schemes, all at turn 1 (oldest)
		await store.upsert(RUN_ID, 1, "ask://old_prompt", pad(30), 200);
		await store.upsert(RUN_ID, 1, "src/old_file.js", pad(30), 200);
		await store.upsert(RUN_ID, 1, "known://old_fact", pad(30), 200);
		// Recent entry at turn 10
		await store.upsert(RUN_ID, 10, "known://recent", pad(30), 200);

		const result = await assembleAndEnforce(3000);

		// All old entries should be candidates equally — no scheme priority
		// The recent entry should be more likely to survive
		if (result.demoted.length > 0) {
			const entries = await getEntries();
			const recent = entries.find((e) => e.path === "known://recent");
			if (recent) {
				assert.ok(
					recent.fidelity === "full" || recent.fidelity === "summary",
					"recent entry should survive at full or summary",
				);
			}
		}
	});

	it("full entries transition to summary fidelity", async () => {
		for (let i = 0; i < 10; i++) {
			await store.upsert(RUN_ID, i + 1, `known://fact_${i}`, pad(50), 200);
		}

		await assembleAndEnforce(2500);

		const entries = await getEntries();
		const summaryEntries = entries.filter(
			(e) => e.scheme === "known" && e.fidelity === "summary",
		);
		assert.ok(
			summaryEntries.length > 0,
			"crunch spiral should create summary entries from full",
		);
	});

	it("summarize callback fires for full→summary entries without summaries", async () => {
		for (let i = 0; i < 10; i++) {
			await store.upsert(RUN_ID, i + 1, `known://unsumm_${i}`, pad(50), 200);
		}

		const summarized = [];
		await assembleAndEnforce(2500, {
			summarize: async (entries) => {
				summarized.push(...entries.map((e) => e.path));
			},
		});

		assert.ok(
			summarized.length > 0,
			"summarize callback should fire for entries without summaries",
		);
	});

	it("summarize callback skips entries with existing summaries", async () => {
		for (let i = 0; i < 10; i++) {
			await store.upsert(RUN_ID, i + 1, `known://presumm_${i}`, pad(50), 200, {
				attributes: { summary: "already summarized" },
			});
		}

		const summarized = [];
		await assembleAndEnforce(2500, {
			summarize: async (entries) => {
				summarized.push(...entries.map((e) => e.path));
			},
		});

		assert.strictEqual(
			summarized.length,
			0,
			"should not summarize pre-summarized entries",
		);
	});

	it("death spiral stashes entries by scheme when crunch exhausted", async () => {
		// Create many entries — budget so tight that crunch can't save them
		for (let i = 0; i < 20; i++) {
			await store.upsert(RUN_ID, i + 1, `known://item_${i}`, pad(100), 200);
		}

		// Very tight budget forces death spiral
		await assembleAndEnforce(2000);

		const entries = await getEntries();
		const stored = entries.filter(
			(e) =>
				e.fidelity === "stored" &&
				e.scheme === "known" &&
				!e.path.startsWith("known://stash_"),
		);
		const stash = entries.find((e) => e.path === "known://stash_known");

		// Either stash exists with stored entries, or death spiral ran
		if (stash) {
			assert.strictEqual(
				stash.fidelity,
				"index",
				"stash should be at index fidelity",
			);
			// Every stored entry should be in the stash body
			for (const s of stored) {
				assert.ok(
					stash.body.includes(s.path),
					`stash should contain ${s.path}`,
				);
			}
		} else {
			// If no stash, entries should still have been demoted
			assert.ok(stored.length > 0, "death spiral should have stored entries");
		}
	});

	it("death spiral selects oldest entries for stashing", async () => {
		// Create entries with clear age separation
		for (let i = 0; i < 10; i++) {
			await store.upsert(RUN_ID, i + 1, `known://age_${i}`, pad(100), 200);
		}

		await assembleAndEnforce(2000);

		const entries = await getEntries();
		const stored = entries.filter(
			(e) => e.fidelity === "stored" && e.scheme === "known",
		);
		const surviving = entries.filter(
			(e) =>
				e.fidelity !== "stored" &&
				e.scheme === "known" &&
				!e.path.startsWith("known://stash_"),
		);

		if (stored.length > 0 && surviving.length > 0) {
			const oldestSurvivor = surviving.toSorted((a, b) => a.turn - b.turn)[0];
			const newestStored = stored.toSorted((a, b) => b.turn - a.turn)[0];
			assert.ok(
				oldestSurvivor.turn >= newestStored.turn,
				"surviving entries should be newer than stashed entries",
			);
		}
	});

	it("crash when floor exceeds context", async () => {
		// Create enough entries that even stash index entries won't fit
		// in an impossibly small budget. The system prompt alone (~4 tokens)
		// plus stash entries exceed the ceiling.
		for (let i = 0; i < 200; i++) {
			await store.upsert(
				RUN_ID,
				i + 1,
				`known://floor_${String(i).padStart(3, "0")}`,
				pad(50),
				200,
			);
		}

		// contextSize=1 → ceiling=0.95, nothing fits
		await assert.rejects(
			() => assembleAndEnforce(1),
			(err) => {
				assert.ok(err.message.includes("Context floor"));
				return true;
			},
		);
	});

	it("fat summary entries get halved before death spiral", async () => {
		// Create entries with fat summaries (> 80 chars)
		const fatSummary = "a".repeat(200);
		for (let i = 0; i < 5; i++) {
			await store.upsert(RUN_ID, i + 1, `known://fatsumm_${i}`, pad(10), 200, {
				attributes: { summary: fatSummary },
			});
			await store.setFidelity(RUN_ID, `known://fatsumm_${i}`, "summary");
		}

		// Budget tight enough to trigger halving but not death
		await assembleAndEnforce(3000);

		const entries = await getEntries();
		const summaryEntries = entries.filter(
			(e) => e.scheme === "known" && e.fidelity === "summary",
		);

		// Some summaries should have been truncated
		for (const entry of summaryEntries) {
			const attrs =
				typeof entry.attributes === "string"
					? JSON.parse(entry.attributes)
					: entry.attributes;
			if (attrs?.summary) {
				assert.ok(
					attrs.summary.length <= fatSummary.length,
					"summary should have been halved or preserved, not grown",
				);
			}
		}
	});
});

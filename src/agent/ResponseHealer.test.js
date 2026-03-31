import assert from "node:assert";
import { describe, it } from "node:test";
import ResponseHealer from "./ResponseHealer.js";

describe("ResponseHealer", () => {
	describe("assessProgress", () => {
		it("summary terminates the run", () => {
			const healer = new ResponseHealer();
			const result = healer.assessProgress({
				summaryText: "all done",
				flags: { hasAct: true, hasReads: true, hasWrites: true },
			});
			assert.strictEqual(result.continue, false);
		});

		it("summary terminates even with no tools", () => {
			const healer = new ResponseHealer();
			const result = healer.assessProgress({
				summaryText: "finished",
				flags: { hasAct: false, hasReads: false, hasWrites: false },
			});
			assert.strictEqual(result.continue, false);
		});

		it("tools without summary continues", () => {
			const healer = new ResponseHealer();
			const result = healer.assessProgress({
				summaryText: null,
				flags: { hasAct: true, hasReads: false, hasWrites: false },
			});
			assert.strictEqual(result.continue, true);
		});

		it("reads without summary continues", () => {
			const healer = new ResponseHealer();
			const result = healer.assessProgress({
				summaryText: null,
				flags: { hasAct: false, hasReads: true, hasWrites: false },
			});
			assert.strictEqual(result.continue, true);
		});

		it("writes without summary continues", () => {
			const healer = new ResponseHealer();
			const result = healer.assessProgress({
				summaryText: null,
				flags: { hasAct: false, hasReads: false, hasWrites: true },
			});
			assert.strictEqual(result.continue, true);
		});

		it("no tools no summary increments stall counter", () => {
			const healer = new ResponseHealer();
			const r1 = healer.assessProgress({
				summaryText: null,
				flags: { hasAct: false, hasReads: false, hasWrites: false },
			});
			assert.strictEqual(r1.continue, true);
		});

		it("stalls force-complete after MAX_STALLS idle turns", () => {
			const healer = new ResponseHealer();
			for (let i = 0; i < 2; i++) {
				healer.assessProgress({
					summaryText: null,
					flags: { hasAct: false, hasReads: false, hasWrites: false },
				});
			}
			const result = healer.assessProgress({
				summaryText: null,
				flags: { hasAct: false, hasReads: false, hasWrites: false },
			});
			assert.strictEqual(result.continue, false);
			assert.ok(result.reason);
		});

		it("tools reset stall counter", () => {
			const healer = new ResponseHealer();

			// Two idle turns
			healer.assessProgress({
				summaryText: null,
				flags: { hasAct: false, hasReads: false, hasWrites: false },
			});
			healer.assessProgress({
				summaryText: null,
				flags: { hasAct: false, hasReads: false, hasWrites: false },
			});

			// Tool use resets
			healer.assessProgress({
				summaryText: null,
				flags: { hasAct: false, hasReads: true, hasWrites: false },
			});

			// Two more idle — should not hit MAX_STALLS yet
			healer.assessProgress({
				summaryText: null,
				flags: { hasAct: false, hasReads: false, hasWrites: false },
			});
			const result = healer.assessProgress({
				summaryText: null,
				flags: { hasAct: false, hasReads: false, hasWrites: false },
			});
			assert.strictEqual(result.continue, true);
		});

		it("reset clears state", () => {
			const healer = new ResponseHealer();
			healer.assessProgress({
				summaryText: null,
				flags: { hasAct: false, hasReads: false, hasWrites: false },
			});
			healer.assessProgress({
				summaryText: null,
				flags: { hasAct: false, hasReads: false, hasWrites: false },
			});
			healer.reset();

			// After reset, stall counter is 0 again
			const result = healer.assessProgress({
				summaryText: null,
				flags: { hasAct: false, hasReads: false, hasWrites: false },
			});
			assert.strictEqual(result.continue, true);
		});
	});
});

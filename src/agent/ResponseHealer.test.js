import assert from "node:assert";
import { describe, it } from "node:test";
import ResponseHealer from "./ResponseHealer.js";

describe("ResponseHealer", () => {
	describe("healSummary", () => {
		it("returns existing summary unchanged", () => {
			const result = ResponseHealer.healSummary("done", "", []);
			assert.strictEqual(result, "done");
		});

		it("uses plain text as summary when no commands", () => {
			const result = ResponseHealer.healSummary(null, "I did the thing.", []);
			assert.strictEqual(result, "I did the thing.");
		});

		it("truncates long plain text to 500 chars", () => {
			const long = "x".repeat(600);
			const result = ResponseHealer.healSummary(null, long, []);
			assert.strictEqual(result.length, 500);
		});

		it("injects placeholder when commands exist but no summary", () => {
			const result = ResponseHealer.healSummary(null, "", [{ name: "read" }]);
			assert.strictEqual(result, "...");
		});

		it("injects placeholder for empty content with no commands", () => {
			const result = ResponseHealer.healSummary(null, "", []);
			assert.strictEqual(result, "...");
		});

		it("injects placeholder for whitespace-only content", () => {
			const result = ResponseHealer.healSummary(null, "   \n  ", []);
			assert.strictEqual(result, "...");
		});
	});

	describe("assessProgress", () => {
		it("actions count as progress", () => {
			const healer = new ResponseHealer();
			const result = healer.assessProgress({
				summaryText: "did stuff",
				flags: { hasAct: true, hasReads: false, hasWrites: false },
			});
			assert.strictEqual(result.continue, true);
		});

		it("reads count as progress", () => {
			const healer = new ResponseHealer();
			const result = healer.assessProgress({
				summaryText: "reading files",
				flags: { hasAct: false, hasReads: true, hasWrites: false },
			});
			assert.strictEqual(result.continue, true);
		});

		it("writes count as progress", () => {
			const healer = new ResponseHealer();
			const result = healer.assessProgress({
				summaryText: "saving knowledge",
				flags: { hasAct: false, hasReads: false, hasWrites: true },
			});
			assert.strictEqual(result.continue, true);
		});

		it("first idle turn completes", () => {
			const healer = new ResponseHealer();
			const result = healer.assessProgress({
				summaryText: "all done",
				flags: { hasAct: false, hasReads: false, hasWrites: false },
			});
			assert.strictEqual(result.continue, false);
		});

		it("repeated idle after progress stalls eventually", () => {
			const healer = new ResponseHealer();

			// First turn: progress
			healer.assessProgress({
				summaryText: "reading",
				flags: { hasAct: false, hasReads: true, hasWrites: false },
			});

			// Now idle with same summary — stalling
			for (let i = 0; i < 2; i++) {
				const r = healer.assessProgress({
					summaryText: "stuck",
					flags: { hasAct: false, hasReads: false, hasWrites: false },
				});
				if (i === 0) assert.strictEqual(r.continue, false);
			}
		});

		it("progress resets stall counter", () => {
			const healer = new ResponseHealer();

			// Idle
			healer.assessProgress({
				summaryText: "idle 1",
				flags: { hasAct: false, hasReads: false, hasWrites: false },
			});

			// Progress — resets
			healer.assessProgress({
				summaryText: "working",
				flags: { hasAct: true, hasReads: false, hasWrites: false },
			});

			// Idle again — first idle after progress = done, not stall
			const result = healer.assessProgress({
				summaryText: "done now",
				flags: { hasAct: false, hasReads: false, hasWrites: false },
			});
			assert.strictEqual(result.continue, false);
			assert.ok(!result.reason);
		});

		it("reset clears state", () => {
			const healer = new ResponseHealer();
			healer.assessProgress({
				summaryText: "x",
				flags: { hasAct: false, hasReads: false, hasWrites: false },
			});
			healer.reset();
			const result = healer.assessProgress({
				summaryText: "fresh start",
				flags: { hasAct: false, hasReads: false, hasWrites: false },
			});
			assert.strictEqual(result.continue, false);
			assert.ok(!result.reason);
		});
	});
});

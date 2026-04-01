import assert from "node:assert";
import { describe, it } from "node:test";
import ResponseHealer from "./ResponseHealer.js";

describe("ResponseHealer", () => {
	describe("healUpdate", () => {
		it("uses plain text as update when no commands", () => {
			const result = ResponseHealer.healUpdate("I did the thing.", []);
			assert.strictEqual(result, "I did the thing.");
		});

		it("truncates long plain text to 500 chars", () => {
			const long = "x".repeat(600);
			const result = ResponseHealer.healUpdate(long, []);
			assert.strictEqual(result.length, 500);
		});

		it("injects placeholder when commands exist but no status tag", () => {
			const result = ResponseHealer.healUpdate("", [{ name: "read" }]);
			assert.strictEqual(result, "...");
		});

		it("injects placeholder for empty content with no commands", () => {
			const result = ResponseHealer.healUpdate("", []);
			assert.strictEqual(result, "...");
		});

		it("injects placeholder for whitespace-only content", () => {
			const result = ResponseHealer.healUpdate("   \n  ", []);
			assert.strictEqual(result, "...");
		});
	});

	describe("assessProgress", () => {
		it("summary terminates the run", () => {
			const healer = new ResponseHealer();
			const result = healer.assessProgress({
				summaryText: "all done",
				updateText: null,
			});
			assert.strictEqual(result.continue, false);
		});

		it("update continues the run", () => {
			const healer = new ResponseHealer();
			const result = healer.assessProgress({
				summaryText: null,
				updateText: "reading files",
			});
			assert.strictEqual(result.continue, true);
		});

		it("neither increments stall counter and continues", () => {
			const healer = new ResponseHealer();
			const result = healer.assessProgress({
				summaryText: null,
				updateText: null,
			});
			assert.strictEqual(result.continue, true);
		});

		it("stalls force-complete after MAX_STALLS", () => {
			const healer = new ResponseHealer();
			for (let i = 0; i < 2; i++) {
				healer.assessProgress({ summaryText: null, updateText: null });
			}
			const result = healer.assessProgress({
				summaryText: null,
				updateText: null,
			});
			assert.strictEqual(result.continue, false);
			assert.ok(result.reason);
		});

		it("update resets stall counter", () => {
			const healer = new ResponseHealer();
			healer.assessProgress({ summaryText: null, updateText: null });
			healer.assessProgress({ summaryText: null, updateText: null });
			// One more would stall — but update resets
			healer.assessProgress({ summaryText: null, updateText: "working" });
			healer.assessProgress({ summaryText: null, updateText: null });
			healer.assessProgress({ summaryText: null, updateText: null });
			const result = healer.assessProgress({
				summaryText: null,
				updateText: null,
			});
			assert.strictEqual(result.continue, false);
		});

		it("summary resets stall counter", () => {
			const healer = new ResponseHealer();
			healer.assessProgress({ summaryText: null, updateText: null });
			healer.assessProgress({ summaryText: null, updateText: null });
			const result = healer.assessProgress({
				summaryText: "done",
				updateText: null,
			});
			assert.strictEqual(result.continue, false);
			assert.ok(!result.reason);
		});

		it("reset clears state", () => {
			const healer = new ResponseHealer();
			healer.assessProgress({ summaryText: null, updateText: null });
			healer.assessProgress({ summaryText: null, updateText: null });
			healer.reset();
			// After reset, counter is 0 — needs 3 more to stall
			const result = healer.assessProgress({
				summaryText: null,
				updateText: null,
			});
			assert.strictEqual(result.continue, true);
		});

		it("healed update increments stall counter", () => {
			const healer = new ResponseHealer();
			for (let i = 0; i < 3; i++) {
				healer.assessProgress({
					summaryText: null,
					updateText: "...",
					statusHealed: true,
				});
			}
			const result = healer.assessProgress({
				summaryText: null,
				updateText: "...",
				statusHealed: true,
			});
			assert.strictEqual(result.continue, false);
			assert.ok(result.reason);
		});

		it("genuine update resets stall counter from healed stalls", () => {
			const healer = new ResponseHealer();
			healer.assessProgress({
				summaryText: null,
				updateText: "...",
				statusHealed: true,
			});
			healer.assessProgress({
				summaryText: null,
				updateText: "...",
				statusHealed: true,
			});
			healer.assessProgress({ summaryText: null, updateText: "working" });
			assert.strictEqual(
				healer.assessProgress({
					summaryText: null,
					updateText: "...",
					statusHealed: true,
				}).continue,
				true,
			);
		});
	});
});

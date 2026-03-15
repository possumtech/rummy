import assert from "node:assert";
import { describe, it } from "node:test";
import HookRegistry from "./HookRegistry.js";

describe("HookRegistry (DOM Pipeline)", () => {
	it("should execute processors in priority order", async () => {
		const registry = new HookRegistry();
		const results = [];

		registry.onTurn(async () => results.push(2), 20);
		registry.onTurn(async () => results.push(1), 10);

		await registry.processTurn({ mock: true });
		assert.deepStrictEqual(results, [1, 2]);
	});

	it("should apply filters correctly", async () => {
		const registry = new HookRegistry();
		registry.addFilter("test", (val) => `${val} world`);
		const res = await registry.applyFilters("test", "hello");
		assert.strictEqual(res, "hello world");
	});
});

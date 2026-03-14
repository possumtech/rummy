import assert from "node:assert";
import { describe, it, mock } from "node:test";
import ModelAgent from "./ModelAgent.js";

describe("ModelAgent", () => {
	it("should return a list of models from the database", async () => {
		const mockModels = [
			{ id: "test-model", name: "Test Model", description: "A test model" },
		];
		const mockDb = {
			get_models: {
				all: mock.fn(async () => mockModels),
			},
		};

		const agent = new ModelAgent(mockDb);
		const models = await agent.getModels();

		assert.deepStrictEqual(models, mockModels);
		assert.strictEqual(mockDb.get_models.all.mock.callCount(), 1);
	});
});

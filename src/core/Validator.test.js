import assert from "node:assert";
import { describe, it } from "node:test";
import Validator from "./Validator.js";

describe("Validator", () => {
	it("should throw if environment variables are missing", () => {
		const original = process.env.OPENROUTER_API_KEY;
		delete process.env.OPENROUTER_API_KEY;

		assert.throws(() => {
			Validator.validateEnv();
		}, /Missing required environment variables/);

		process.env.OPENROUTER_API_KEY = original;
	});

	it("should not throw if all required env vars are present", () => {
		// Validator.validateEnv() should pass if we have our test environment set up
		assert.doesNotThrow(() => Validator.validateEnv());
	});
});

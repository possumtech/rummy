import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSummaries } from "./crunch.js";

describe("Crunch parseSummaries", () => {
	const entries = [
		{ path: "known://api_config", body: "REST API uses OAuth2" },
		{ path: "known://deploy", body: "Deploys to AWS ECS" },
	];

	it("parses valid multi-line response", () => {
		const response = [
			"known://api_config → OAuth2 PKCE, 30d refresh, 100 req/min",
			"known://deploy → AWS ECS us-west-2, GH Actions CI",
		].join("\n");

		const results = parseSummaries(response, entries);
		assert.strictEqual(results.length, 2);
		assert.strictEqual(results[0].path, "known://api_config");
		assert.strictEqual(
			results[0].summary,
			"OAuth2 PKCE, 30d refresh, 100 req/min",
		);
		assert.strictEqual(results[1].path, "known://deploy");
	});

	it("skips lines without arrow separator", () => {
		const response = [
			"known://api_config → OAuth2 PKCE",
			"This line has no arrow",
			"known://deploy → AWS ECS",
		].join("\n");

		const results = parseSummaries(response, entries);
		assert.strictEqual(results.length, 2);
	});

	it("truncates summaries over 80 chars", () => {
		const long = "a".repeat(120);
		const response = `known://api_config → ${long}`;

		const results = parseSummaries(response, entries);
		assert.strictEqual(results.length, 1);
		assert.strictEqual(results[0].summary.length, 80);
	});

	it("skips paths not in entries", () => {
		const response = "known://unknown_path → some keywords";

		const results = parseSummaries(response, entries);
		assert.strictEqual(results.length, 0);
	});

	it("returns empty array for empty response", () => {
		assert.strictEqual(parseSummaries("", entries).length, 0);
		assert.strictEqual(parseSummaries(null, entries).length, 0);
	});

	it("skips lines with empty summary after arrow", () => {
		const response = "known://api_config → ";

		const results = parseSummaries(response, entries);
		assert.strictEqual(results.length, 0);
	});

	it("handles blank lines in response", () => {
		const response = [
			"",
			"known://api_config → OAuth2 config",
			"",
			"known://deploy → ECS deploy",
			"",
		].join("\n");

		const results = parseSummaries(response, entries);
		assert.strictEqual(results.length, 2);
	});
});

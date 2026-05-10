import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Rm from "./rm.js";

describe("Rm", () => {
	const plugin = new Rm({
		registerScheme() {},
		on() {},
		filter() {},
	});

	it("full returns raw emission body (line-numbering in materializeContext)", () => {
		const result = plugin.full({
			attributes: { path: "known://old" },
			body: '<rm path="known://old"/>',
		});
		assert.equal(result, '<rm path="known://old"/>');
	});

	it("full passes multi-line emissions through verbatim", () => {
		const result = plugin.full({
			attributes: { path: "known://chunk_*" },
			body: '<rm path="known://chunk_*">\nbody\n</rm>',
		});
		assert.equal(result, '<rm path="known://chunk_*">\nbody\n</rm>');
	});

	it("manifest: lists matched paths without removing", async () => {
		const removed = [];
		const upserted = [];
		const matches = [
			{ path: "known://temp_a", scheme: "known", tokens: 100, body: "..." },
			{ path: "known://temp_b", scheme: "known", tokens: 50, body: "..." },
		];
		const store = {
			getEntriesByPattern: async () => matches,
			rm: async ({ path }) => removed.push(path),
			set: async ({ path, body, state }) =>
				upserted.push({ path, body, state }),
			logPath: async (_r, t, s, p) =>
				`log://turn_${t}/${s}/${encodeURIComponent(p)}`,
		};
		const rummy = {
			entries: store,
			sequence: 1,
			runId: 1,
			loopId: 1,
		};
		const entry = {
			attributes: { path: "known://temp_*", manifest: "" },
			resultPath: "rm://result",
		};
		await plugin.handler(entry, rummy);
		assert.equal(removed.length, 0, "manifest must not remove anything");
		const log = upserted.find((u) => u.path?.startsWith("log://"));
		assert.ok(log, "wrote a manifest log entry");
		assert.match(log.body, /^MANIFEST rm path="known:\/\/temp_\*": 2 matched/);
		assert.ok(log.body.includes("known://temp_a (100)"));
		assert.ok(log.body.includes("known://temp_b (50)"));
	});
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Cp from "./cp.js";

function stubCore() {
	return {
		registerScheme() {},
		on() {},
		filter() {},
	};
}

function makeStore({ bodies = {}, attributes = {} } = {}) {
	const calls = [];
	let seq = 0;
	return {
		_calls: calls,
		async set(args) {
			calls.push(args);
		},
		async getBody(_runId, path) {
			return path in bodies ? bodies[path] : null;
		},
		async getAttributes(_runId, path) {
			return path in attributes ? attributes[path] : null;
		},
		async logPath(_runId, _loopId, turn, action) {
			seq += 1;
			return `log://1/${turn}/${seq}/${action}`;
		},
	};
}

describe("Cp", () => {
	it("full returns raw emission body (line-numbering in materializeContext)", () => {
		const plugin = new Cp(stubCore());
		const result = plugin.full({
			attributes: { from: "a", to: "b" },
			body: '<cp path="a">b</cp>',
		});
		assert.equal(result, '<cp path="a">b</cp>');
	});

	describe("handler — bare-file destination decomposition", () => {
		// cp to a bare path decomposes into (a) a resolved cp recap
		// (model audit) at log://*/cp and (b) a set proposal at a
		// fresh log://*/set path. The wire surface the client renders
		// against is the set proposal — same shape as a direct
		// `<set path="X">...` from the model.
		it("emits resolved cp recap + a set proposal with set-shape attrs", async () => {
			const plugin = new Cp(stubCore());
			const store = makeStore({
				bodies: { "https://x.example/page": "fetched body content" },
			});
			await plugin.handler(
				{
					attributes: { path: "https://x.example/page", to: "src/out.c" },
					resultPath: "log://1/1/1/cp",
				},
				{ entries: store, sequence: 1, runId: "r", loopId: "l" },
			);
			const recap = store._calls.find((c) => c.path === "log://1/1/1/cp");
			const proposal = store._calls.find(
				(c) =>
					c.state === "proposed" && typeof c.path === "string" && /\/set$/.test(c.path),
			);
			assert.ok(recap, "cp recap entry written");
			assert.equal(recap.state, "resolved", "recap is resolved, not proposed");
			assert.equal(recap.attributes.from, "https://x.example/page");
			assert.equal(recap.attributes.to, "src/out.c");
			assert.equal(recap.attributes.isMove, false);

			assert.ok(proposal, "set proposal emitted alongside recap");
			assert.equal(proposal.attributes.path, "src/out.c");
			assert.equal(
				proposal.attributes.patched,
				"fetched body content",
				"patched carries the source body for the materializer",
			);
			assert.ok(
				proposal.attributes.patch?.startsWith("==="),
				"set proposal carries attrs.patch (udiff) — uniform set-shape wire surface",
			);
			assert.equal(proposal.attributes.op, "new");
			// cp's wire shape on the proposal must not leak cp-specific
			// metadata clients would render differently:
			assert.equal(proposal.attributes.from, undefined);
			assert.equal(proposal.attributes.isMove, undefined);
		});

		it("destination already exists: patch shows the diff, proposal still set-shaped", async () => {
			const plugin = new Cp(stubCore());
			const store = makeStore({
				bodies: {
					"https://x.example/page": "new",
					"src/out.c": "old",
				},
			});
			await plugin.handler(
				{
					attributes: { path: "https://x.example/page", to: "src/out.c" },
					resultPath: "log://1/1/1/cp",
				},
				{ entries: store, sequence: 1, runId: "r", loopId: "l" },
			);
			const proposal = store._calls.find(
				(c) =>
					c.state === "proposed" && typeof c.path === "string" && /\/set$/.test(c.path),
			);
			assert.equal(proposal.attributes.patched, "new");
			assert.match(proposal.attributes.patch, /-old/);
			assert.match(proposal.attributes.patch, /\+new/);
			const recap = store._calls.find((c) => c.path === "log://1/1/1/cp");
			assert.match(recap.attributes.warning, /Overwrote/);
		});
	});

	describe("handler — schemed destination (immediate resolution)", () => {
		it("writes source body to schemed destination + resolved log entry", async () => {
			const plugin = new Cp(stubCore());
			const store = makeStore({ bodies: { "src/a.js": "source code" } });
			await plugin.handler(
				{
					attributes: { path: "src/a.js", to: "known://archive" },
					resultPath: "log://turn_1/cp/x",
				},
				{ entries: store, sequence: 1, runId: "r", loopId: "l" },
			);
			const dest = store._calls.find((c) => c.path === "known://archive");
			assert.ok(dest);
			assert.equal(dest.body, "source code");
			assert.equal(dest.state, "resolved");
			const log = store._calls.find((c) => c.path === "log://turn_1/cp/x");
			assert.equal(log.state, "resolved");
		});

		it("propagates source's tags to destination when no explicit tags=", async () => {
			const plugin = new Cp(stubCore());
			const store = makeStore({
				bodies: { "known://draft": "body" },
				attributes: { "known://draft": { tags: "geography,france" } },
			});
			await plugin.handler(
				{
					attributes: { path: "known://draft", to: "known://archive/draft" },
					resultPath: "log://turn_1/cp/x",
				},
				{ entries: store, sequence: 1, runId: "r", loopId: "l" },
			);
			const dest = store._calls.find((c) => c.path === "known://archive/draft");
			assert.equal(dest.attributes.tags, "geography,france");
		});

		it("explicit tags= on cp wins over source tags", async () => {
			const plugin = new Cp(stubCore());
			const store = makeStore({
				bodies: { "known://draft": "body" },
				attributes: { "known://draft": { tags: "old,tags" } },
			});
			await plugin.handler(
				{
					attributes: {
						path: "known://draft",
						to: "known://archive/draft",
						tags: "new,tags",
					},
					resultPath: "log://turn_1/cp/x",
				},
				{ entries: store, sequence: 1, runId: "r", loopId: "l" },
			);
			const dest = store._calls.find((c) => c.path === "known://archive/draft");
			assert.equal(dest.attributes.tags, "new,tags");
		});
	});

	it("handler is a no-op when source body is missing", async () => {
		const plugin = new Cp(stubCore());
		const store = makeStore({ bodies: {} });
		await plugin.handler(
			{
				attributes: { path: "missing://thing", to: "src/x" },
				resultPath: "log://turn_1/cp/x",
			},
			{ entries: store, sequence: 1, runId: "r", loopId: "l" },
		);
		assert.equal(store._calls.length, 0);
	});

	it("manifest: lists matched sources without copying", async () => {
		const plugin = new Cp(stubCore());
		const matches = [
			{ path: "known://plan_a", scheme: "known", tokens: 80 },
			{ path: "known://plan_b", scheme: "known", tokens: 120 },
		];
		const store = {
			_calls: [],
			async set(args) {
				this._calls.push(args);
			},
			async getEntriesByPattern() {
				return matches;
			},
			async getBody() {
				throw new Error("manifest must not read source body");
			},
			async logPath(_r, t, s, p) {
				return `log://turn_${t}/${s}/${encodeURIComponent(p)}`;
			},
		};
		await plugin.handler(
			{
				attributes: {
					path: "known://plan_*",
					to: "known://archive_",
					manifest: "",
				},
				resultPath: "cp://result",
			},
			{ entries: store, sequence: 1, runId: "r", loopId: "l" },
		);
		const log = store._calls.find((c) => c.path?.startsWith("log://"));
		assert.ok(log, "wrote a manifest log entry");
		assert.match(log.body, /^MANIFEST cp path="known:\/\/plan_\*": 2 matched/);
		assert.ok(log.body.includes("known://plan_a"));
		assert.ok(log.body.includes("known://plan_b"));
	});
});

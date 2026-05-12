import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Mv from "./mv.js";

describe("Mv", () => {
	const plugin = new Mv({
		registerScheme() {},
		on() {},
		filter() {},
	});

	it("full returns raw emission body (line-numbering happens in materializeContext)", () => {
		const result = plugin.full({
			attributes: { from: "a", to: "b" },
			body: '<mv path="a">b</mv>',
		});
		assert.equal(result, '<mv path="a">b</mv>');
	});

	it("on set-proposal accept (linked by recap.setProposal): atomic source rm, no second prompt", async () => {
		// User's accept on the destination set IS the move agreement.
		// No second prompt for source cleanup — the post-accept hook
		// performs the removal atomically and emits a resolved /rm log
		// entry for audit.
		const upserted = [];
		const removed = [];
		const recapPath = "log://1/3/1/mv";
		const setPath = "log://1/3/2/set";
		const recap = {
			path: recapPath,
			attributes: JSON.stringify({
				from: "known://draft",
				to: "deliverable.md",
				isMove: true,
				setProposal: setPath,
			}),
		};
		const store = {
			set: async (args) => upserted.push(args),
			rm: async (args) => removed.push(args),
			getEntriesByPattern: async () => [recap],
			logPath: async () => "log://1/3/3/rm",
		};
		const ctx = {
			runId: 1,
			loopId: 1,
			turn: 3,
			path: setPath,
			entries: store,
			projectRoot: null, // schemed source — no filesystem unlink
		};
		// Trigger the post-accept hook directly. (proposal.accepted is the
		// hook channel; mv subscribes in its constructor.)
		const core = {
			registerScheme() {},
			on(name, fn) {
				if (name === "proposal.accepted") core._hook = fn;
			},
			filter() {},
		};
		new Mv(core);
		await core._hook(ctx);

		assert.ok(
			removed.some((r) => r.path === "known://draft"),
			"source entry removed atomically",
		);
		const auditRm = upserted.find(
			(u) => typeof u.path === "string" && u.path.endsWith("/rm"),
		);
		assert.ok(auditRm, "resolved /rm audit log entry emitted");
		assert.equal(auditRm.state, "resolved");
		assert.equal(auditRm.attributes.path, "known://draft");
		assert.equal(auditRm.attributes.mv, recapPath);
	});

	it("schemed → bare-path: emits resolved mv recap + set proposal (source rm fires on set accept)", async () => {
		// mv to a bare path decomposes into (a) a resolved mv recap +
		// (b) a set proposal at destination. The rm proposal for the
		// source is emitted ONLY after the set is accepted (serial),
		// so the client never asks about removing source if the user
		// rejected the destination create. The recap carries
		// attrs.setProposal as linkage for the post-accept hook.
		const upserted = [];
		let logSeq = 0;
		const store = {
			getBody: async (_r, p) =>
				p === "known://draft" ? "draft body content" : null,
			getAttributes: async () => null,
			set: async (args) => upserted.push(args),
			rm: async () => {
				throw new Error("schemed→bare-path mv must not rm before accept");
			},
			logPath: async (_r, _l, turn, action) => {
				logSeq += 1;
				return `log://1/${turn}/${logSeq}/${action}`;
			},
		};
		const rummy = { entries: store, sequence: 5, runId: 1, loopId: 1 };
		const entry = {
			attributes: { path: "known://draft", to: "deliverable.md" },
			resultPath: "log://1/5/1/mv",
		};
		await plugin.handler(entry, rummy);

		const recap = upserted.find((u) => u.path === entry.resultPath);
		assert.ok(recap, "mv recap written");
		assert.equal(recap.state, "resolved", "recap is resolved");
		assert.equal(recap.attributes.from, "known://draft");
		assert.equal(recap.attributes.to, "deliverable.md");
		assert.equal(recap.attributes.isMove, true);
		assert.ok(
			typeof recap.attributes.setProposal === "string" &&
				recap.attributes.setProposal.endsWith("/set"),
			"recap carries setProposal linkage for the post-accept rm hook",
		);

		const setProposal = upserted.find(
			(u) =>
				u.state === "proposed" &&
				typeof u.path === "string" &&
				u.path.endsWith("/set"),
		);
		assert.ok(setProposal, "set proposal emitted at the linked path");
		assert.equal(setProposal.attributes.path, "deliverable.md");
		assert.equal(setProposal.attributes.patched, "draft body content");
		assert.ok(setProposal.attributes.patch?.startsWith("==="), "set proposal carries udiff");
		assert.equal(
			setProposal.attributes.from,
			undefined,
			"mv-specific metadata not leaked onto the set proposal's wire shape",
		);
		assert.equal(setProposal.attributes.isMove, undefined);
	});

	it("schemed → schemed: auto-resolves (entry-to-entry, no proposal)", async () => {
		// Schema-to-schema mv stays in entry-space — no disk write, no
		// proposal. Resolve immediately.
		const upserted = [];
		const removed = [];
		const store = {
			getBody: async (_r, p) => (p === "known://draft" ? "draft body" : null),
			getAttributes: async () => null,
			set: async (args) => upserted.push(args),
			rm: async (args) => removed.push(args),
		};
		const rummy = { entries: store, sequence: 5, runId: 1, loopId: 1 };
		const entry = {
			attributes: { path: "known://draft", to: "known://final" },
			resultPath: "log://turn_5/mv/known___draft",
		};
		await plugin.handler(entry, rummy);

		const dest = upserted.find((u) => u.path === "known://final");
		assert.ok(dest, "destination entry written");
		assert.equal(dest.body, "draft body");
		assert.equal(dest.state, "resolved");
		assert.ok(
			removed.some((r) => r.path === "known://draft"),
			"source entry removed",
		);
		const log = upserted.find((u) => u.path === entry.resultPath);
		assert.equal(log.state, "resolved");
	});

	it("schemed → schemed: source tags propagate to destination", async () => {
		const upserted = [];
		const store = {
			getBody: async (_r, p) => (p === "known://draft" ? "body" : null),
			getAttributes: async (_r, p) =>
				p === "known://draft" ? { tags: "geography,france" } : null,
			set: async (args) => upserted.push(args),
			rm: async () => {},
		};
		const rummy = { entries: store, sequence: 5, runId: 1, loopId: 1 };
		await plugin.handler(
			{
				attributes: { path: "known://draft", to: "known://final" },
				resultPath: "log://turn_5/mv/known___draft",
			},
			rummy,
		);
		const dest = upserted.find((u) => u.path === "known://final");
		assert.equal(dest.attributes.tags, "geography,france");
	});

	it("schemed → schemed: explicit tags= overrides source tags", async () => {
		const upserted = [];
		const store = {
			getBody: async (_r, p) => (p === "known://draft" ? "body" : null),
			getAttributes: async (_r, p) =>
				p === "known://draft" ? { tags: "old,tags" } : null,
			set: async (args) => upserted.push(args),
			rm: async () => {},
		};
		const rummy = { entries: store, sequence: 5, runId: 1, loopId: 1 };
		await plugin.handler(
			{
				attributes: {
					path: "known://draft",
					to: "known://final",
					tags: "new,tags",
				},
				resultPath: "log://turn_5/mv/known___draft",
			},
			rummy,
		);
		const dest = upserted.find((u) => u.path === "known://final");
		assert.equal(dest.attributes.tags, "new,tags");
	});

	it("manifest: lists matched paths without moving or flipping visibility", async () => {
		const upserted = [];
		const matches = [
			{ path: "known://draft_1", scheme: "known", tokens: 200 },
			{ path: "known://draft_2", scheme: "known", tokens: 150 },
		];
		const store = {
			getEntriesByPattern: async () => matches,
			set: async (args) => upserted.push(args),
			rm: async () => {
				throw new Error("manifest must not rm");
			},
			getBody: async () => {
				throw new Error("manifest must not read source body");
			},
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
			attributes: {
				path: "known://draft_*",
				to: "known://archive_",
				manifest: "",
			},
			resultPath: "mv://result",
		};
		await plugin.handler(entry, rummy);
		const log = upserted.find((u) => u.path?.startsWith("log://"));
		assert.ok(log, "wrote a manifest log entry");
		assert.match(log.body, /^MANIFEST mv path="known:\/\/draft_\*": 2 matched/);
		assert.ok(log.body.includes("known://draft_1"));
		assert.ok(log.body.includes("known://draft_2"));
	});
});

/**
 * Proposal wire contract — what external clients (rummy.nvim, web UI,
 * future renderers) MUST be able to read off a proposed-set entry.
 *
 * The proposed entry is the surface between the harness and any UI
 * that renders the change to a human. Internal state-machine tests
 * verify proposed→resolved/failed transitions; this file verifies the
 * attribute set clients depend on.
 *
 * If these fail, no plugin/UI consumer can render the change. Past
 * incidents: dropping `attrs.patch` for "unification" broke rummy.nvim's
 * diff render path; nvim auto-cancelled proposals it couldn't render;
 * runs died at 499 with outcome=permission.
 */
import assert from "node:assert";
import { after, before, describe, it } from "node:test";
// biome-ignore lint/suspicious/noShadowRestrictedNames: tool plugin's class is "Set" by design
import Set from "../../src/plugins/set/set.js";
import TestDb from "../helpers/TestDb.js";

function stubCore() {
	return {
		registerScheme() {},
		ensureTool() {},
		on() {},
		filter() {},
		hooks: {},
	};
}

describe("proposal wire contract (@resolution, @plugins_set)", () => {
	let tdb;
	let plugin;
	let store;

	before(async () => {
		tdb = await TestDb.create("proposal_wire_contract");
		plugin = new Set(stubCore());
		const Entries = (await import("../../src/agent/Entries.js")).default;
		store = new Entries(tdb.db);
	});

	after(async () => {
		await tdb.cleanup();
	});

	it("file-write proposal carries the full attribute set clients read", async () => {
		const { runId, loopId } = await tdb.seedRun({ alias: "wire_filewrite" });
		const proposalPath = await store.logPath(runId, loopId, 1, "set");
		const newContent = "# Hello\n\nbody line one\nbody line two\n";

		// Drive the actual set.js handler with the parser-output shape:
		// `attrs.operations` is what XmlParser produces from
		// `<<NEW>>...NEW`. inner carries the verbatim HEREDOC.
		await plugin.handler(
			{
				path: proposalPath,
				resultPath: proposalPath,
				attributes: {
					path: "RUMSFELD.md",
					inner: `<<NEW\n${newContent}\nNEW`,
					operations: [{ op: "new", content: newContent }],
					tags: "essay,test",
				},
			},
			{ entries: store, sequence: 1, runId, loopId },
		);

		// Read the proposal back the same way wire clients would:
		// resolve the entry by path. Assert the contract.
		const matches = await store.getEntriesByPattern(runId, proposalPath, null);
		assert.equal(matches.length, 1, "exactly one proposal entry");
		const proposal = matches[0];
		const attrs =
			typeof proposal.attributes === "string"
				? JSON.parse(proposal.attributes)
				: proposal.attributes;

		assert.equal(
			proposal.state,
			"proposed",
			"file write lands as state=proposed",
		);
		assert.equal(attrs.path, "RUMSFELD.md", "attrs.path = target");
		assert.equal(
			attrs.patched,
			newContent,
			"attrs.patched = full new content (materializer reads this on accept)",
		);
		assert.ok(
			typeof attrs.patch === "string" && attrs.patch.length > 0,
			"attrs.patch = udiff projection for client diff rendering (nvim, web UI)",
		);
		assert.match(
			attrs.patch,
			/^=+\n---/,
			"attrs.patch is unified diff (createTwoFilesPatch banner shape)",
		);
		assert.match(attrs.patch, /\+# Hello/, "udiff shows added content");
		assert.equal(attrs.op, "new", "attrs.op = operative intent");
		assert.ok(
			Array.isArray(attrs.opPositions) && attrs.opPositions.length === 1,
			"attrs.opPositions = per-op breakdown for clients",
		);
		assert.equal(typeof attrs.afterActionTokens, "number");
		assert.ok(attrs.afterActionTokens > 0);
	});

	it("scheme-write proposal carries attrs.patch as udiff projection", async () => {
		const { runId, loopId } = await tdb.seedRun({ alias: "wire_schemewrite" });
		const proposalPath = await store.logPath(runId, loopId, 1, "set");

		await plugin.handler(
			{
				body: "v2",
				path: proposalPath,
				resultPath: proposalPath,
				attributes: { path: "known://x", inner: "v2" },
			},
			{ entries: store, sequence: 1, runId, loopId },
		);

		const matches = await store.getEntriesByPattern(runId, proposalPath, null);
		const proposal = matches[0];
		const attrs =
			typeof proposal.attributes === "string"
				? JSON.parse(proposal.attributes)
				: proposal.attributes;

		assert.equal(attrs.path, "known://x");
		assert.ok(
			typeof attrs.patch === "string" && attrs.patch.length > 0,
			"attrs.patch present on scheme writes too — clients render diffs uniformly",
		);
		assert.match(attrs.patch, /^=+\n---/, "attrs.patch is udiff");
		assert.match(attrs.patch, /\+v2/, "udiff shows added content");
	});
});

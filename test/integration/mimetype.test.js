/**
 * Mimetype contract — engine floor.
 *
 * Covers @mimetype: every entry carries a `mimetype` attribute (default
 * `text/markdown` when unset); textual mimetypes get line-numbered
 * `<get>` output via the engine's universal floor; binary mimetypes
 * refuse with soft `405 {mimetype} fetch unsupported`. The classifier
 * lives in `src/agent/mimetype.js`; the refusal logic in
 * `src/plugins/get/get.js`.
 */
import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import Entries from "../../src/agent/Entries.js";
import Get from "../../src/plugins/get/get.js";
import TestDb from "../helpers/TestDb.js";

describe("mimetype: engine floor (@mimetype)", () => {
	let tdb;
	let store;
	let plugin;

	before(async () => {
		tdb = await TestDb.create("mimetype");
		// Wire Entries with the filter-chain resolver — mirrors what
		// ProjectAgent does in the production graph. Without this, mimetype
		// stamping uses the engine default only (no plugin extension
		// resolution).
		store = new Entries(tdb.db, {
			resolveMimetype: (ctx) =>
				tdb.hooks.entry.mimetype.filter("text/markdown", ctx),
		});
		plugin = new Get({
			registerScheme: () => {},
			on: () => {},
			filter: () => {},
		});
	});

	after(async () => {
		await tdb.cleanup();
	});

	it("binary `<get>` returns soft 405 with verbatim refusal body", async () => {
		const { runId, loopId } = await tdb.seedRun({ alias: "mimetype_binary" });
		await store.set({
			runId,
			turn: 1,
			loopId,
			path: "docs/diagram.png",
			body: "\x89PNG...",
			state: "resolved",
			attributes: { mimetype: "image/png" },
		});

		const resultPath = await store.logPath(runId, loopId, 1, "get");
		await plugin.handler(
			{
				attributes: { path: "docs/diagram.png" },
				resultPath,
			},
			{
				entries: store,
				sequence: 1,
				runId,
				loopId,
				hooks: { error: { log: { emit: async () => {} } } },
			},
		);

		const rows = await tdb.db.get_known_entries.all({ run_id: runId });
		const log = rows.find((r) => r.path === resultPath);
		assert.ok(log, "get action entry written");
		assert.equal(log.state, "resolved", "soft (state=resolved)");
		assert.equal(log.outcome, "status:405");
		assert.equal(log.body, "image/png fetch unsupported");
		const attrs = JSON.parse(log.attributes);
		assert.equal(attrs.mimetype, "image/png");
	});

	it("textual `<get>` returns the body and stamps mimetype on the action entry", async () => {
		const { runId, loopId } = await tdb.seedRun({ alias: "mimetype_textual" });
		await store.set({
			runId,
			turn: 1,
			loopId,
			path: "docs/notes.md",
			body: "alpha\nbeta\ngamma",
			state: "resolved",
			attributes: { mimetype: "text/markdown" },
		});

		const resultPath = await store.logPath(runId, loopId, 1, "get");
		await plugin.handler(
			{
				attributes: { path: "docs/notes.md" },
				resultPath,
			},
			{
				entries: store,
				sequence: 1,
				runId,
				loopId,
				hooks: { error: { log: { emit: async () => {} } } },
			},
		);

		const rows = await tdb.db.get_known_entries.all({ run_id: runId });
		const log = rows.find((r) => r.path === resultPath);
		assert.equal(log.state, "resolved");
		assert.equal(log.outcome, null);
		assert.equal(log.body, "alpha\nbeta\ngamma");
		const attrs = JSON.parse(log.attributes);
		assert.equal(attrs.mimetype, "text/markdown");
	});

	it("unset mimetype defaults to text/markdown (textual passthrough)", async () => {
		const { runId, loopId } = await tdb.seedRun({ alias: "mimetype_default" });
		await store.set({
			runId,
			turn: 1,
			loopId,
			path: "src/x.js",
			body: "const x = 1;",
			state: "resolved",
			// no mimetype attr — engine default is text/markdown (textual)
		});

		const resultPath = await store.logPath(runId, loopId, 1, "get");
		await plugin.handler(
			{
				attributes: { path: "src/x.js" },
				resultPath,
			},
			{
				entries: store,
				sequence: 1,
				runId,
				loopId,
				hooks: { error: { log: { emit: async () => {} } } },
			},
		);

		const rows = await tdb.db.get_known_entries.all({ run_id: runId });
		const log = rows.find((r) => r.path === resultPath);
		assert.equal(log.state, "resolved");
		assert.equal(log.outcome, null, "no 405 — default treats unset as textual");
		assert.equal(log.body, "const x = 1;");
	});

	it("application/pdf is binary, refuses with 405", async () => {
		const { runId, loopId } = await tdb.seedRun({ alias: "mimetype_pdf" });
		await store.set({
			runId,
			turn: 1,
			loopId,
			path: "docs/spec.pdf",
			body: "%PDF...",
			state: "resolved",
			attributes: { mimetype: "application/pdf" },
		});

		const resultPath = await store.logPath(runId, loopId, 1, "get");
		await plugin.handler(
			{
				attributes: { path: "docs/spec.pdf" },
				resultPath,
			},
			{
				entries: store,
				sequence: 1,
				runId,
				loopId,
				hooks: { error: { log: { emit: async () => {} } } },
			},
		);

		const rows = await tdb.db.get_known_entries.all({ run_id: runId });
		const log = rows.find((r) => r.path === resultPath);
		assert.equal(log.outcome, "status:405");
		assert.equal(log.body, "application/pdf fetch unsupported");
	});

	it("Entries.set stamps mimetype via filter chain when caller omits it", async () => {
		const { runId, loopId } = await tdb.seedRun({ alias: "mimetype_stamp" });
		// Join the filter chain like rummy.repo does — extension lookup.
		const dispose = tdb.hooks.entry.mimetype.addFilter((_current, ctx) => {
			if (ctx.path.endsWith(".js")) return "text/javascript";
			if (ctx.path.endsWith(".json")) return "application/json";
			return null;
		});
		try {
			await store.set({
				runId,
				turn: 1,
				loopId,
				path: "known://x.js",
				body: "const x = 1;",
				state: "resolved",
				// no explicit mimetype — engine fires the filter chain
			});
			const rows = await tdb.db.get_known_entries.all({ run_id: runId });
			const entry = rows.find((r) => r.path === "known://x.js");
			assert.ok(entry, "entry persisted");
			const attrs = JSON.parse(entry.attributes);
			assert.equal(
				attrs.mimetype,
				"text/javascript",
				"extension-resolved mimetype stamped on entry",
			);
		} finally {
			if (typeof dispose === "function") dispose();
		}
	});

	it("Entries.set respects explicit mimetype — does not override caller intent", async () => {
		const { runId, loopId } = await tdb.seedRun({
			alias: "mimetype_explicit",
		});
		await store.set({
			runId,
			turn: 1,
			loopId,
			path: "known://override.js",
			body: "raw",
			state: "resolved",
			attributes: { mimetype: "text/plain" },
		});
		const rows = await tdb.db.get_known_entries.all({ run_id: runId });
		const entry = rows.find((r) => r.path === "known://override.js");
		const attrs = JSON.parse(entry.attributes);
		assert.equal(attrs.mimetype, "text/plain");
	});

	it("Entries.set does not stamp mimetype on log:// entries (action-keyed dispatch)", async () => {
		const { runId, loopId } = await tdb.seedRun({ alias: "mimetype_log" });
		await store.set({
			runId,
			turn: 1,
			loopId,
			path: `log://1/1/1/set`,
			body: "log content",
			state: "resolved",
			// no explicit mimetype, no attributes — log entries skip
			// stamping; their action handler owns dispatch.
		});
		const rows = await tdb.db.get_known_entries.all({ run_id: runId });
		const entry = rows.find((r) => r.path === "log://1/1/1/set");
		assert.ok(entry, "log entry persisted");
		if (entry.attributes) {
			const attrs = JSON.parse(entry.attributes);
			assert.equal(
				attrs.mimetype,
				undefined,
				"log entries do not receive engine mimetype stamping",
			);
		}
	});

	it("binary chunked read (lineFirst/lineFinal) refuses with 405 — line semantics don't apply", async () => {
		const { runId, loopId } = await tdb.seedRun({
			alias: "mimetype_binary_chunk",
		});
		await store.set({
			runId,
			turn: 1,
			loopId,
			path: "docs/diagram.png",
			body: "binary garbage",
			state: "resolved",
			attributes: { mimetype: "image/png" },
		});

		const resultPath = await store.logPath(runId, loopId, 1, "get");
		await plugin.handler(
			{
				attributes: {
					path: "docs/diagram.png",
					linefirst: "1",
					linefinal: "100",
				},
				resultPath,
			},
			{
				entries: store,
				sequence: 1,
				runId,
				loopId,
				hooks: { error: { log: { emit: async () => {} } } },
			},
		);

		const rows = await tdb.db.get_known_entries.all({ run_id: runId });
		const log = rows.find((r) => r.path === resultPath);
		assert.equal(log.outcome, "status:405");
		assert.equal(log.body, "image/png fetch unsupported");
	});
});

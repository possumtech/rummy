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
		store = new Entries(tdb.db);
		// Plugin needs a registerScheme/on/filter stub. The classifier and
		// 405 branch are exercised through the handler directly.
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

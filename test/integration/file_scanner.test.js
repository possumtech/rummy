import assert from "node:assert";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import KnownStore from "../../src/agent/KnownStore.js";
import RummyContext from "../../src/hooks/RummyContext.js";
import FileScanner from "../../src/plugins/file/FileScanner.js";
import TestDb from "../helpers/TestDb.js";

describe("FileScanner integration", () => {
	let tdb, store, scanner, rummy, PROJECT_ID, RUN_ID;
	const projectPath = join(tmpdir(), `rummy-scanner-${Date.now()}`);

	before(async () => {
		await fs.mkdir(projectPath, { recursive: true });

		tdb = await TestDb.create();
		store = new KnownStore(tdb.db);
		const seed = await tdb.seedRun({
			path: projectPath,
			name: "ScannerTest",
			alias: "scan_1",
		});
		PROJECT_ID = seed.projectId;
		RUN_ID = seed.runId;
		rummy = new RummyContext(null, {
			hooks: tdb.hooks,
			db: tdb.db,
			store,
			project: {
				id: PROJECT_ID,
				project_root: projectPath,
				name: "ScannerTest",
			},
			type: "act",
			sequence: 1,
			runId: RUN_ID,
			turnId: 1,
			noContext: false,
			contextSize: 50000,
			systemPrompt: "",
			loopPrompt: "",
		});
	});

	after(async () => {
		await tdb.cleanup();
		await fs.rm(projectPath, { recursive: true, force: true });
	});

	it("adds new files to the store", async () => {
		await fs.writeFile(join(projectPath, "app.js"), "const x = 1;\n");

		scanner = new FileScanner(store, tdb.db, tdb.hooks);
		await scanner.scan(projectPath, PROJECT_ID, ["app.js"], 1, rummy);

		const entries = await store.getFileEntries(RUN_ID);
		const app = entries.find((e) => e.path === "app.js");
		assert.ok(app, "app.js should be in store");
		assert.strictEqual(app.state, "index", "new files default to index");
		assert.ok(app.hash, "should have hash");
	});

	it("skips unchanged files (mtime within tolerance)", async () => {
		const entriesBefore = await store.getFileEntries(RUN_ID);
		const appBefore = entriesBefore.find((e) => e.path === "app.js");

		// Scan again without touching the file
		await scanner.scan(projectPath, PROJECT_ID, ["app.js"], 2, rummy);

		const entriesAfter = await store.getFileEntries(RUN_ID);
		const appAfter = entriesAfter.find((e) => e.path === "app.js");
		assert.strictEqual(appAfter.hash, appBefore.hash, "hash should not change");
	});

	it("detects content changes via hash", async () => {
		const entriesBefore = await store.getFileEntries(RUN_ID);
		const hashBefore = entriesBefore.find((e) => e.path === "app.js").hash;

		// Change file content and set mtime 2 seconds in the future
		// to exceed the 1-second tolerance
		await fs.writeFile(join(projectPath, "app.js"), "const x = 2;\n");
		const future = new Date(Date.now() + 2000);
		await fs.utimes(join(projectPath, "app.js"), future, future);

		await scanner.scan(projectPath, PROJECT_ID, ["app.js"], 3, rummy);

		const entriesAfter = await store.getFileEntries(RUN_ID);
		const hashAfter = entriesAfter.find((e) => e.path === "app.js").hash;
		assert.notStrictEqual(hashAfter, hashBefore, "hash should change");
	});

	it("removes deleted files from store", async () => {
		await fs.writeFile(join(projectPath, "temp.js"), "// temp\n");
		await scanner.scan(
			projectPath,
			PROJECT_ID,
			["app.js", "temp.js"],
			4,
			rummy,
		);

		let entries = await store.getFileEntries(RUN_ID);
		assert.ok(
			entries.find((e) => e.path === "temp.js"),
			"temp.js should exist",
		);

		// Delete from disk, scan without it in mappableFiles
		await fs.unlink(join(projectPath, "temp.js"));
		await scanner.scan(projectPath, PROJECT_ID, ["app.js"], 5, rummy);

		entries = await store.getFileEntries(RUN_ID);
		assert.ok(
			!entries.find((e) => e.path === "temp.js"),
			"temp.js should be removed",
		);
	});

	it("only active-constrained files get full state, all others get index", async () => {
		await fs.mkdir(join(projectPath, "src"), { recursive: true });
		await fs.writeFile(join(projectPath, "root.js"), "// root\n");
		await fs.writeFile(join(projectPath, "src/nested.js"), "// nested\n");
		await fs.writeFile(join(projectPath, "active.js"), "// active\n");

		// Set active constraint on one file
		await tdb.db.upsert_file_constraint.run({
			project_id: PROJECT_ID,
			pattern: "active.js",
			visibility: "active",
		});

		await scanner.scan(
			projectPath,
			PROJECT_ID,
			["root.js", "src/nested.js", "active.js"],
			7,
			rummy,
		);

		const all = await tdb.db.get_known_entries.all({ run_id: RUN_ID });
		const root = all.find((e) => e.path === "root.js");
		const nested = all.find((e) => e.path === "src/nested.js");
		const active = all.find((e) => e.path === "active.js");
		assert.strictEqual(root.state, "index", "root file gets index state");
		assert.strictEqual(nested.state, "index", "nested file gets index state");
		assert.strictEqual(active.state, "full", "active file gets full state");
	});
});

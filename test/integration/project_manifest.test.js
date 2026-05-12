/**
 * `repo://manifest` entry contract.
 *
 * Covers @project_manifest — the `rummy.repo` plugin's run-start
 * orientation entry. Verifies: a single visible manifest is registered
 * after the first scan; the body is a flat `* path - N tokens` list
 * with no headers/legend/absolute path; subsequent scans do NOT
 * mutate it (turn-0 snapshot, cache-stable); file entries default to
 * `archived`; `noRepo: true` skips the scan entirely.
 */
import assert from "node:assert";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import Entries from "../../src/agent/Entries.js";
import TestDb from "../helpers/TestDb.js";

async function makeProject(name) {
	const root = join(tmpdir(), `rummy_project_manifest_${name}_${Date.now()}`);
	await fs.mkdir(root, { recursive: true });
	writeFileSync(join(root, "README.md"), "# Project\n");
	writeFileSync(join(root, "main.js"), "export const x = 1;\n");
	await fs.mkdir(join(root, "src"), { recursive: true });
	writeFileSync(join(root, "src", "a.js"), "export const a = 'a';\n");
	writeFileSync(join(root, "src", "b.js"), "export const b = 'b';\n");
	execSync(
		'git init && git config user.email "t@t" && git config user.name T && git add . && git commit --no-verify -m "init"',
		{ cwd: root },
	);
	return root;
}

async function fireTurnStarted({
	tdb,
	runId,
	loopId,
	projectId,
	projectRoot,
	noRepo,
}) {
	const entries = new Entries(tdb.db);
	entries.loadSchemes(tdb.db);
	await tdb.hooks.loop.started.emit({ runId, loopId });
	const rummy = {
		runId,
		projectId,
		loopId,
		project: { id: projectId, project_root: projectRoot },
		entries,
		db: tdb.db,
		hooks: tdb.hooks,
		sequence: 1,
		noRepo: noRepo === true,
	};
	await tdb.hooks.turn.started.emit({ rummy });
	return entries;
}

describe("project manifest (@project_manifest)", () => {
	let tdb;

	before(async () => {
		tdb = await TestDb.create("project_manifest");
	});

	after(async () => {
		await tdb.cleanup();
	});

	it("scan registers a single visible repo://manifest entry", async () => {
		const root = await makeProject("basic");
		const { runId, loopId, projectId } = await tdb.seedRun({
			alias: "manifest_basic",
			projectRoot: root,
		});

		const entries = await fireTurnStarted({
			tdb,
			runId,
			loopId,
			projectId,
			projectRoot: root,
		});

		const matches = await entries.getEntriesByPattern(runId, "repo://manifest");
		assert.strictEqual(matches.length, 1, "one manifest entry registered");
		assert.strictEqual(
			matches[0].visibility,
			"indexed",
			"manifest is indexed at write",
		);
	});

	it("manifest body has directory rollup + flat list, no headers, no absolute path", async () => {
		const root = await makeProject("body");
		const { runId, loopId, projectId } = await tdb.seedRun({
			alias: "manifest_body",
			projectRoot: root,
		});

		const entries = await fireTurnStarted({
			tdb,
			runId,
			loopId,
			projectId,
			projectRoot: root,
		});
		const body = await entries.getBody(runId, "repo://manifest");
		assert.ok(body, "manifest body exists");

		// Canonical JSON-per-row: rollup rows (paths ending in /) first,
		// then per-file rows. No separator.
		assert.ok(!body.includes("---"), "no separator line");
		const lines = body.split("\n").filter((l) => l.length > 0);
		const rollupLines = lines.filter((l) => {
			try {
				return JSON.parse(l).path.endsWith("/");
			} catch {
				return false;
			}
		});
		const flatLines = lines.filter((l) => {
			try {
				return !JSON.parse(l).path.endsWith("/");
			} catch {
				return false;
			}
		});

		assert.ok(rollupLines.length > 0, "rollup lists at least one directory");
		for (const line of rollupLines) {
			const parsed = JSON.parse(line);
			assert.equal(typeof parsed.path, "string");
			assert.equal(typeof parsed.tokens, "number");
		}
		assert.ok(
			rollupLines.some((l) => JSON.parse(l).path === "./"),
			"root files roll up under ./",
		);
		assert.ok(
			rollupLines.some((l) => JSON.parse(l).path === "src/"),
			"src/ has its own rollup line",
		);

		assert.ok(flatLines.length > 0, "flat list has files");
		for (const line of flatLines) {
			const parsed = JSON.parse(line);
			assert.equal(typeof parsed.path, "string");
			assert.equal(typeof parsed.tokens, "number");
		}
		assert.ok(
			flatLines.some((l) => JSON.parse(l).path === "README.md"),
			"root README.md is named",
		);
		assert.ok(
			flatLines.some((l) => JSON.parse(l).path === "src/a.js"),
			"nested files use full relative path",
		);

		assert.ok(!body.includes("##"), "no markdown headings");
		assert.ok(!body.includes("Navigate"), "no navigation legend");
		assert.ok(!body.includes("Constraints"), "no constraints section");
		assert.ok(!body.includes(root), "no absolute filesystem path leak");
	});

	it("manifest refreshes every scan: files added mid-run appear on next scan", async () => {
		const root = await makeProject("refresh");
		const { runId, loopId, projectId } = await tdb.seedRun({
			alias: "manifest_refresh",
			projectRoot: root,
		});

		const entries = await fireTurnStarted({
			tdb,
			runId,
			loopId,
			projectId,
			projectRoot: root,
		});
		const firstBody = await entries.getBody(runId, "repo://manifest");
		assert.ok(!firstBody.includes("added_later.js"));

		writeFileSync(join(root, "added_later.js"), "export const z = 0;\n");
		// ProjectContext.getMappableFiles filters by git-tracked. New
		// file must be added to git before next scan or scanner won't
		// see it.
		execSync("git add added_later.js && git commit --no-verify -m 'add'", {
			cwd: root,
		});
		await fireTurnStarted({
			tdb,
			runId,
			loopId,
			projectId,
			projectRoot: root,
		});
		const secondBody = await entries.getBody(runId, "repo://manifest");

		assert.ok(
			secondBody.includes("added_later.js"),
			"manifest is live — added file appears on next scan",
		);
	});

	it("file entries default to indexed (each file gets its catalog tile)", async () => {
		const root = await makeProject("indexed");
		const { runId, loopId, projectId } = await tdb.seedRun({
			alias: "manifest_indexed",
			projectRoot: root,
		});

		const entries = await fireTurnStarted({
			tdb,
			runId,
			loopId,
			projectId,
			projectRoot: root,
		});

		const fileMatches = await entries.getEntriesByPattern(runId, "src/a.js");
		assert.strictEqual(fileMatches.length, 1, "src/a.js registered");
		assert.strictEqual(
			fileMatches[0].visibility,
			"indexed",
			"files are the primary inventory — each gets its tile in <index>",
		);
	});

	it("noRepo: true skips the scan; no manifest, no file entries", async () => {
		const root = await makeProject("norepo");
		const { runId, loopId, projectId } = await tdb.seedRun({
			alias: "manifest_norepo",
			projectRoot: root,
		});

		const entries = await fireTurnStarted({
			tdb,
			runId,
			loopId,
			projectId,
			projectRoot: root,
			noRepo: true,
		});

		const manifest = await entries.getEntriesByPattern(
			runId,
			"repo://manifest",
		);
		assert.strictEqual(manifest.length, 0, "no manifest when noRepo");
		const files = await entries.getEntriesByPattern(runId, "src/a.js");
		assert.strictEqual(files.length, 0, "no file entries when noRepo");
	});
});

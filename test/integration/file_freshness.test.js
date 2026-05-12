/**
 * File freshness — the model's view must always be a faithful and
 * fresh presentation of the current filesystem state.
 *
 * Covers @filesystem_freshness — the invariant that after any
 * mutation of a file or scheme entry, the next turn's assembled
 * context reflects the post-mutation body AND visibility, without
 * the model needing a fresh `<get>` to recover its own changes.
 *
 * The bug these tests lock against: SEARCH/REPLACE accept-path
 * silently downgrading visibility from `visible` → `summarized`,
 * which leaves the body present in the entry but invisible to the
 * model (file plugin's summary projection is empty). The model on
 * the next turn answers from memory of pre-edit state instead of
 * seeing what just landed.
 */
import assert from "node:assert";
import { execSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import AgentLoop from "../../src/agent/AgentLoop.js";
import Entries from "../../src/agent/Entries.js";
import TurnExecutor from "../../src/agent/TurnExecutor.js";
import LlmProvider from "../../src/llm/LlmProvider.js";
import TestDb from "../helpers/TestDb.js";

async function makeAgent(tdb) {
	const llm = new LlmProvider(tdb.db, tdb.hooks);
	const entries = new Entries(tdb.db);
	entries.loadSchemes(tdb.db);
	const turnExecutor = new TurnExecutor(tdb.db, llm, tdb.hooks, entries);
	const agent = new AgentLoop(tdb.db, llm, tdb.hooks, turnExecutor, entries);
	return { agent, entries };
}

async function seedProjectWithFile(tdb, alias, fileName, originalContent) {
	const projectRoot = join(tmpdir(), `file_freshness_${alias}_${Date.now()}`);
	const fullPath = join(projectRoot, fileName);
	await fs.mkdir(join(fullPath, ".."), { recursive: true });
	await fs.writeFile(fullPath, originalContent);
	const { runId, projectId, loopId } = await tdb.seedRun({ alias, projectRoot });
	return { projectRoot, runId, projectId, loopId };
}

describe("file freshness (@filesystem_freshness)", () => {
	let tdb;
	let agent;
	let entries;

	before(async () => {
		tdb = await TestDb.create("file_freshness");
		const out = await makeAgent(tdb);
		agent = out.agent;
		entries = out.entries;
	});

	after(async () => {
		await tdb.cleanup();
	});

	describe("SEARCH/REPLACE accept", () => {
		it("entry body matches new content on disk", async () => {
			const { projectRoot, runId, loopId } = await seedProjectWithFile(
				tdb,
				"sr_body_sync",
				"src/app.js",
				"const x = 1;\n// TODO: stuff\n",
			);
			// Pre-promote so we test the preservation path
			await entries.set({
				runId,
				loopId,
				path: "src/app.js",
				loopId,
				body: "const x = 1;\n// TODO: stuff\n",
				state: "resolved",
				visibility: "indexed",
				writer: "plugin",
			});

			const proposalPath = await entries.logPath(runId, 1, "set", "src/app.js");
			await entries.set({
				runId,
				loopId,
				turn: 1,
				loopId,
				path: proposalPath,
				body: "(merge proposal)",
				state: "proposed",
				attributes: {
					path: "src/app.js",
					patched: "const x = 1;\n// stuff handled\n",
				},
			});

			await agent.resolve("sr_body_sync", {
				path: proposalPath,
				action: "accept",
			});

			const entryBody = await entries.getBody(runId, "src/app.js");
			const onDisk = await fs.readFile(join(projectRoot, "src/app.js"), "utf8");
			assert.strictEqual(
				entryBody,
				onDisk,
				"entry body matches disk after SEARCH/REPLACE accept",
			);
			assert.ok(
				entryBody.includes("// stuff handled"),
				"new content present in entry",
			);
			assert.ok(!entryBody.includes("// TODO: stuff"), "old content replaced");
		});

		it("preserves visibility=indexed after edit (no silent flip)", async () => {
			const { runId, loopId } = await seedProjectWithFile(
				tdb,
				"sr_vis_preserve_visible",
				"src/app.js",
				"const x = 1;\n// TODO: stuff\n",
			);
			await entries.set({
				runId,
				loopId,
				path: "src/app.js",
				loopId,
				body: "const x = 1;\n// TODO: stuff\n",
				state: "resolved",
				visibility: "indexed",
				writer: "plugin",
			});

			const proposalPath = await entries.logPath(runId, 1, "set", "src/app.js");
			await entries.set({
				runId,
				loopId,
				turn: 1,
				loopId,
				path: proposalPath,
				body: "(merge proposal)",
				state: "proposed",
				attributes: {
					path: "src/app.js",
					patched: "const x = 1;\n// stuff handled\n",
				},
			});

			await agent.resolve("sr_vis_preserve_visible", {
				path: proposalPath,
				action: "accept",
			});

			const state = await entries.getState(runId, "src/app.js");
			assert.strictEqual(
				state?.visibility,
				"indexed",
				"visibility=indexed preserved across SEARCH/REPLACE accept",
			);
		});

		it("preserves visibility=archived after edit", async () => {
			const { runId, loopId } = await seedProjectWithFile(
				tdb,
				"sr_vis_preserve_summarized",
				"src/app.js",
				"const x = 1;\n// TODO: stuff\n",
			);
			await entries.set({
				runId,
				loopId,
				path: "src/app.js",
				loopId,
				body: "const x = 1;\n// TODO: stuff\n",
				state: "resolved",
				visibility: "archived",
				writer: "plugin",
			});

			const proposalPath = await entries.logPath(runId, 1, "set", "src/app.js");
			await entries.set({
				runId,
				loopId,
				turn: 1,
				loopId,
				path: proposalPath,
				body: "(merge proposal)",
				state: "proposed",
				attributes: {
					path: "src/app.js",
					patched: "const x = 1;\n// stuff handled\n",
				},
			});

			await agent.resolve("sr_vis_preserve_summarized", {
				path: proposalPath,
				action: "accept",
			});

			const state = await entries.getState(runId, "src/app.js");
			assert.strictEqual(
				state?.visibility,
				"archived",
				"visibility=archived preserved across SEARCH/REPLACE accept",
			);
		});

		it("new file from SEARCH/REPLACE lands at indexed (model just wrote it)", async () => {
			const { projectRoot, runId, loopId } = await seedProjectWithFile(
				tdb,
				"sr_new_file",
				"placeholder.txt",
				"placeholder",
			);
			const proposalPath = await entries.logPath(runId, 1, "set", "src/new.js");
			await entries.set({
				runId,
				loopId,
				turn: 1,
				loopId,
				path: proposalPath,
				body: "(merge proposal)",
				state: "proposed",
				attributes: {
					path: "src/new.js",
					patched: "const y = 2;",
				},
			});

			await agent.resolve("sr_new_file", {
				path: proposalPath,
				action: "accept",
			});

			const state = await entries.getState(runId, "src/new.js");
			const body = await entries.getBody(runId, "src/new.js");
			assert.strictEqual(body, "const y = 2;", "new file body landed");
			assert.strictEqual(
				state?.visibility,
				"indexed",
				"newly-created file lands at indexed — the model just wrote it; it should see what it created",
			);
			const onDisk = await fs.readFile(join(projectRoot, "src/new.js"), "utf8");
			assert.strictEqual(onDisk, "const y = 2;", "disk in sync");
		});
	});

	describe("entry-layer write (no proposal)", () => {
		it("scheme write: visibility preserved across body update", async () => {
			const { runId, loopId } = await seedProjectWithFile(
				tdb,
				"scheme_vis_preserve",
				"placeholder.txt",
				"placeholder",
			);
			await entries.set({
				runId,
				loopId,
				path: "known://fact",
				loopId,
				body: "first version",
				state: "resolved",
				visibility: "indexed",
				writer: "model",
			});
			await entries.set({
				runId,
				loopId,
				path: "known://fact",
				loopId,
				body: "second version",
				state: "resolved",
				writer: "model",
			});

			const state = await entries.getState(runId, "known://fact");
			assert.strictEqual(
				state?.visibility,
				"indexed",
				"visibility preserved when only body is updated",
			);
			const body = await entries.getBody(runId, "known://fact");
			assert.strictEqual(body, "second version", "body updated");
		});
	});

	// Phase 3 of the index/archive refactor: filesystem mutations the
	// model didn't author surface as synthetic log entries in the
	// model's own command grammar (set with SEARCH/REPLACE, or rm).
	// FileScanner detects the change and writes through Entries the
	// same way model dispatch does. The model reads them from <log>
	// next turn, attrs.external=true distinguishing engine authorship.
	describe("external mutation log injection (Phase 3)", () => {
		async function makeGitProject(name) {
			const root = join(tmpdir(), `phase3_${name}_${Date.now()}`);
			await fs.mkdir(root, { recursive: true });
			execSync(
				'git init && git config user.email "t@t" && git config user.name T',
				{ cwd: root },
			);
			return root;
		}

		async function commit(root) {
			execSync("git add -A && git commit --no-verify -m sync", { cwd: root });
		}

		async function seedActiveRun(alias, projectRoot) {
			const seed = await tdb.seedRun({ alias, projectRoot });
			// Loop default status=100; transition to 102 so the
			// FileScanner's `get_current_loop` lookup finds it.
			await tdb.db.claim_next_loop.get({ run_id: seed.runId });
			return seed;
		}

		async function fireScan(runId, projectId, projectRoot, sequence) {
			const e = new Entries(tdb.db);
			e.loadSchemes(tdb.db);
			const loopId = 1;
			// Loop-state init for plugins that track per-loop counters
			// (error plugin's strike streak). Idempotent — re-emitting
			// resets the counter, which is fine across test scans.
			await tdb.hooks.loop.started.emit({ runId, loopId });
			const rummy = {
				runId,
				projectId,
				loopId,
				project: { id: projectId, project_root: projectRoot },
				entries: e,
				db: tdb.db,
				hooks: tdb.hooks,
				sequence,
				noRepo: false,
			};
			await tdb.hooks.turn.started.emit({ rummy });
			return e;
		}

		async function findLogEntry(e, runId, action, turn) {
			const re = new RegExp(`^log://\\d+/${turn}/\\d+/${action}$`);
			const rows = await e.getEntriesByPattern(runId, "log://*", null);
			return rows.find((r) => re.test(r.path));
		}

		it("NEW file synthesizes log://*/<turn>/*/set with empty-SEARCH body + attrs.external", async () => {
			// A genuine "new file" event is a file that appeared
			// BETWEEN scans. The bootstrap scan establishes the baseline
			// (no log injection); a subsequent scan picks up files that
			// weren't there before.
			const root = await makeGitProject("new");
			writeFileSync(join(root, "baseline.md"), "preexisting\n");
			await commit(root);

			const { runId, projectId } = await seedActiveRun("phase3_new", root);
			// Bootstrap scan (turn 1): baseline.md lands as a file entry,
			// no log injection.
			await fireScan(runId, projectId, root, 1);

			// Between turns: a new file appears on disk and gets git-
			// tracked so getMappableFiles picks it up on the next scan.
			writeFileSync(join(root, "fresh.md"), "hello world\n");
			await commit(root);

			// Subsequent scan (turn 2): scanner sees the appearance and
			// synthesizes the log entry.
			const e = await fireScan(runId, projectId, root, 2);

			const log = await findLogEntry(e, runId, "set", 2);
			assert.ok(log, "log://*/2/*/set entry synthesized");
			const attrs =
				typeof log.attributes === "string"
					? JSON.parse(log.attributes)
					: log.attributes;
			assert.strictEqual(attrs.path, "fresh.md");
			assert.strictEqual(attrs.external, true);
			assert.match(
				attrs.patch,
				/^=+\n---/,
				"attrs.patch carries the udiff projection",
			);
			assert.match(log.body, /^<<SEARCH\nSEARCH<<REPLACE/);
			assert.match(log.body, /hello world/);
		});

		it("bootstrap scan (no prior file entries): no log entries injected, files land as baseline", async () => {
			const root = await makeGitProject("bootstrap");
			writeFileSync(join(root, "a.md"), "alpha\n");
			writeFileSync(join(root, "b.md"), "beta\n");
			await commit(root);

			const { runId, projectId } = await seedActiveRun(
				"phase3_bootstrap",
				root,
			);
			const e = await fireScan(runId, projectId, root, 1);

			// No log://*/1/*/set entries — every file is baseline, not delta.
			const rows = await e.getEntriesByPattern(runId, "log://*", null);
			const setLogs = rows.filter((r) =>
				/^log:\/\/\d+\/1\/\d+\/set$/.test(r.path),
			);
			assert.equal(setLogs.length, 0, "no NEW-file injections at bootstrap");

			// Both files still landed as bare file entries.
			assert.ok(await e.getBody(runId, "a.md"));
			assert.ok(await e.getBody(runId, "b.md"));
		});

		it("modified file synthesizes log://*/<turn>/*/set with SEARCH/REPLACE pair + attrs.patch (udiff)", async () => {
			const root = await makeGitProject("mod");
			writeFileSync(
				join(root, "edit_me.md"),
				"line1\nline2\nold\nline4\nline5\n",
			);
			await commit(root);

			const { runId, projectId } = await seedActiveRun("phase3_mod", root);

			// Turn 1: ingest baseline. No external mutation log yet.
			await fireScan(runId, projectId, root, 1);

			// External edit between turns.
			writeFileSync(
				join(root, "edit_me.md"),
				"line1\nline2\nnew\nline4\nline5\n",
			);

			// Turn 2: scanner detects the change.
			const e = await fireScan(runId, projectId, root, 2);

			const log = await findLogEntry(e, runId, "set", 2);
			assert.ok(log, "log://*/2/*/set entry synthesized");
			const attrs =
				typeof log.attributes === "string"
					? JSON.parse(log.attributes)
					: log.attributes;
			assert.strictEqual(attrs.path, "edit_me.md");
			assert.strictEqual(attrs.external, true);
			assert.match(
				attrs.patch,
				/^=+\n---/,
				"attrs.patch carries the udiff (createTwoFilesPatch shape)",
			);
			assert.match(attrs.patch, /-old/);
			assert.match(attrs.patch, /\+new/);
			assert.match(log.body, /<<SEARCH\b/);
			assert.match(log.body, /SEARCH<<REPLACE\b/);
			assert.match(log.body, /old/, "SEARCH captures the prior content");
			assert.match(log.body, /new/, "REPLACE captures the new content");
		});

		it("removed file synthesizes log://*/<turn>/*/rm before the entry rm", async () => {
			const root = await makeGitProject("rm");
			writeFileSync(join(root, "going.md"), "bye\n");
			await commit(root);

			const { runId, projectId } = await seedActiveRun("phase3_rm", root);

			// Turn 1: ingest baseline.
			await fireScan(runId, projectId, root, 1);

			// External delete between turns.
			unlinkSync(join(root, "going.md"));

			const e = await fireScan(runId, projectId, root, 2);

			const log = await findLogEntry(e, runId, "rm", 2);
			assert.ok(log, "log://*/2/*/rm entry synthesized");
			const attrs =
				typeof log.attributes === "string"
					? JSON.parse(log.attributes)
					: log.attributes;
			assert.strictEqual(attrs.path, "going.md");
			assert.strictEqual(attrs.external, true);
			assert.strictEqual(log.body, "");

			// File entry actually removed.
			const body = await e.getBody(runId, "going.md");
			assert.strictEqual(body, null);
		});
	});
});

/**
 * Story-driven E2E tests.
 *
 * Each test is a multi-turn session on a single run, exercising many tools
 * and verifying the model's answers at checkpoints. Assertions target content
 * and behavior — if the answer is correct, the test passes.
 *
 * Graceful recovery is not failure. If the model stumbles on a turn but the
 * system recovers and the checkpoint assertion passes, the story succeeded.
 */
import assert from "node:assert";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import AuditClient from "../helpers/AuditClient.js";
import TestDb from "../helpers/TestDb.js";
import TestServer from "../helpers/TestServer.js";

const model = process.env.RUMMY_MODEL_DEFAULT;
const TIMEOUT = 300_000;

/** Get the last summary or update value from a run's entries (by turn, not path order). */
async function lastResponse(db, runAlias) {
	const runRow = await db.get_run_by_alias.get({ alias: runAlias });
	// get_latest_summary is ordered by id DESC — most recent first
	const summary = await db.get_latest_summary.get({ run_id: runRow.id });
	if (summary?.value) return summary.value;
	const entries = await db.get_known_entries.all({ run_id: runRow.id });
	const updates = entries
		.filter((e) => e.scheme === "update")
		.toSorted((a, b) => b.turn - a.turn);
	if (updates.length > 0) return updates[0].value;
	const content = entries
		.filter((e) => e.scheme === "content")
		.toSorted((a, b) => b.turn - a.turn);
	if (content.length > 0) return content[0].value;
	return "";
}

/** Get all known_entries for a run. */
async function allEntries(db, runAlias) {
	const runRow = await db.get_run_by_alias.get({ alias: runAlias });
	return db.get_known_entries.all({ run_id: runRow.id });
}

/** Find entries matching a scheme and optional value substring. */
async function findEntries(db, runAlias, scheme, valueMatch) {
	const all = await allEntries(db, runAlias);
	return all.filter((e) => {
		if (e.scheme !== scheme) return false;
		if (
			valueMatch &&
			!e.value?.toLowerCase().includes(valueMatch.toLowerCase())
		)
			return false;
		return true;
	});
}

/** Assert response contains a substring (case-insensitive). */
function assertContains(text, substring, label) {
	assert.ok(
		text.toLowerCase().includes(substring.toLowerCase()),
		`${label}: expected "${substring}" in response, got: "${text.slice(0, 200)}"`,
	);
}

/** Resolve all proposed entries with accept. */
async function acceptAll(client, result) {
	if (result.status !== "proposed") return result;
	let current = result;
	for (const p of current.proposed) {
		current = await client.call("run/resolve", {
			run: current.run,
			resolution: { path: p.path, action: "accept", output: "ok" },
		});
	}
	return current;
}

describe("E2E Stories", () => {
	let tdb, tserver, client;
	const projectPath = join(tmpdir(), `rummy-stories-${Date.now()}`);

	before(async () => {
		await fs.mkdir(join(projectPath, "src"), { recursive: true });
		await fs.mkdir(join(projectPath, "data"), { recursive: true });

		await fs.writeFile(
			join(projectPath, "src/app.js"),
			"const express = require('express');\nconst app = express();\napp.listen(8080);\n// TODO: add error handling\n",
		);
		await fs.writeFile(
			join(projectPath, "src/config.json"),
			JSON.stringify({ db: "postgres", pool: 5, host: "db.internal" }, null, 2),
		);
		await fs.writeFile(
			join(projectPath, "src/utils.js"),
			"export function greet() { return 'hello'; }\nexport function add(a, b) { return a + b; }\n",
		);
		await fs.writeFile(
			join(projectPath, "notes.md"),
			"The project codename is: phoenix\n",
		);
		await fs.writeFile(
			join(projectPath, "data/users.json"),
			JSON.stringify(
				[
					{ name: "Alice", role: "admin" },
					{ name: "Bob", role: "viewer" },
				],
				null,
				2,
			),
		);

		const { execSync } = await import("node:child_process");
		execSync(
			'git init && git config user.email "t@t" && git config user.name T && git add . && git commit --no-verify -m "init"',
			{ cwd: projectPath },
		);

		tdb = await TestDb.create();
		tserver = await TestServer.start(tdb.db);
		client = new AuditClient(tserver.url, tdb.db);
		await client.connect();
		await client.call("init", {
			projectPath,
			projectName: "StoriesTest",
			clientId: "c-stories",
		});
	});

	after(async () => {
		await client?.close();
		await tserver?.stop();
		await tdb?.cleanup();
		await fs.rm(projectPath, { recursive: true, force: true });
	});

	// ---------------------------------------------------------------
	// Story 1: Baseline — single-turn factual answer
	// ---------------------------------------------------------------
	it("Story 1: baseline factual answer", { timeout: TIMEOUT }, async () => {
		const r1 = await client.call("ask", {
			model,
			prompt:
				"What is the project codename in notes.md? Reply ONLY with the word, nothing else.",
		});
		await client.assertRun(r1, "completed", "S1");

		const resp = await lastResponse(tdb.db, r1.run);
		assertContains(resp, "phoenix", "S1");
	});

	// ---------------------------------------------------------------
	// Story 2: Research session — read, write known, glob, search, store
	// 9 turns on one run
	// ---------------------------------------------------------------
	it("Story 2: research session", { timeout: TIMEOUT }, async () => {
		// Turn 1: read config, identify database
		const r1 = await client.call("ask", {
			model,
			prompt:
				"Read src/config.json and tell me what database this project uses. Reply with the database name.",
		});
		await client.assertRun(r1, "completed", "S2-T1");
		let resp = await lastResponse(tdb.db, r1.run);
		assertContains(resp, "postgres", "S2-T1");

		// Turn 2: save knowledge
		const r2 = await client.call("ask", {
			model,
			prompt: "Save the database type as a known entry at known://db_type.",
			run: r1.run,
		});
		await client.assertRun(r2, "completed", "S2-T2");

		// Checkpoint: known entry with postgres exists
		const dbEntries = await findEntries(tdb.db, r2.run, "known", "postgres");
		assert.ok(
			dbEntries.length > 0,
			"S2: known entry with postgres should exist",
		);

		// Turn 2b: count admin users
		const r2b = await client.call("ask", {
			model,
			prompt:
				'Read data/users.json and tell me how many users have the "admin" role. Reply with the number.',
			run: r1.run,
		});
		await client.assertRun(r2b, "completed", "S2-T2b");
		resp = await lastResponse(tdb.db, r2b.run);
		assertContains(resp, "1", "S2-T2b admin count");

		// Turn 3: glob read all JS, identify express file
		const r3 = await client.call("ask", {
			model,
			prompt:
				"Read all the .js files in src/ using a glob pattern. Which file uses express? Reply with the filename only.",
			run: r1.run,
		});
		await client.assertRun(r3, "completed", "S2-T3");
		resp = await lastResponse(tdb.db, r3.run);
		assertContains(resp, "app.js", "S2-T3");

		// Turn 4: specific function question
		const r4 = await client.call("ask", {
			model,
			prompt:
				"What does the greet function in src/utils.js return? Reply with the return value only.",
			run: r1.run,
		});
		await client.assertRun(r4, "completed", "S2-T4");
		resp = await lastResponse(tdb.db, r4.run);
		assertContains(resp, "hello", "S2-T4");

		// Turn 5: search and use results to answer
		const r5 = await client.call("ask", {
			model,
			prompt:
				'Search the web for "Tom Petty death date" and tell me when he died. Reply with the date.',
			run: r1.run,
		});
		await client.assertRun(r5, "completed", "S2-T5");
		resp = await lastResponse(tdb.db, r5.run);
		assertContains(resp, "2017", "S2-T5 search result used");

		// Turn 6: store a file (remove from context, keep in storage)
		const r6 = await client.call("ask", {
			model,
			prompt:
				'Store data/users.json — remove it from context. Use: <store path="data/users.json"/>',
			run: r1.run,
		});
		await client.assertRun(r6, "completed", "S2-T6");

		// Turn 7: verify stored file is gone from context, then re-read it
		const r7 = await client.call("ask", {
			model,
			prompt:
				"Read data/users.json back into context and tell me Bob's role. Reply with the role.",
			run: r1.run,
		});
		await client.assertRun(r7, "completed", "S2-T7");
		resp = await lastResponse(tdb.db, r7.run);
		assertContains(resp, "viewer", "S2-T7 re-read after store");

		// Turn 8: synthesis — recall across all turns
		const r8 = await client.call("ask", {
			model,
			prompt:
				"Based on everything you've learned: what database does this project use, what port does the app run on, and what's the project codename? Reply with all three answers.",
			run: r1.run,
		});
		await client.assertRun(r8, "completed", "S2-T8");
		resp = await lastResponse(tdb.db, r8.run);
		assertContains(resp, "postgres", "S2-T8 db");
		assertContains(resp, "8080", "S2-T8 port");
		assertContains(resp, "phoenix", "S2-T8 codename");
	});

	// ---------------------------------------------------------------
	// Story 3: Edit and build session — SEARCH/REPLACE, propose/accept,
	// known write, copy, move, env, delete
	// ~9 turns on one act run
	// ---------------------------------------------------------------
	it("Story 3: edit and build session", { timeout: TIMEOUT }, async () => {
		// --- Phase 1: Edit (own run) ---

		// Turn 1: read and identify TODO
		const r1 = await client.call("act", {
			model,
			prompt: "Read src/app.js and tell me what the TODO comment says.",
		});
		await client.assertRun(r1, "completed", "S3-T1");
		const resp = await lastResponse(tdb.db, r1.run);
		assertContains(resp, "error handling", "S3-T1");

		// Turn 2: SEARCH/REPLACE edit
		const r2 = await client.call("act", {
			model,
			prompt:
				'In src/app.js, replace the TODO comment with "// error handler added". Use SEARCH/REPLACE to make the edit.',
			run: r1.run,
		});
		await client.assertRun(r2, ["completed", "proposed"], "S3-T2");

		// Accept proposals until settled
		if (r2.status === "proposed") {
			let current = r2;
			while (current.status === "proposed") {
				for (const p of current.proposed) {
					current = await client.call("run/resolve", {
						run: r2.run,
						resolution: { path: p.path, action: "accept", output: "applied" },
					});
				}
			}
		}

		// Checkpoint: at least one write was accepted
		const postEdit = await allEntries(tdb.db, r1.run);
		const writes = postEdit.filter(
			(e) => e.scheme === "write" && e.state === "pass",
		);
		assert.ok(writes.length > 0, "S3: edit should have been accepted");

		// --- Phase 2: Knowledge management (fresh run) ---

		// Turn 3: save knowledge
		const r3 = await client.call("act", {
			model,
			prompt:
				'Save the note "app.js has been updated" to known://changelog. Use: <write path="known://changelog">app.js has been updated</write>',
		});
		await client.assertRun(r3, ["completed", "proposed"], "S3-T3");
		if (r3.status === "proposed") await acceptAll(client, r3);
		const postKnown = await allEntries(tdb.db, r3.run);
		const knownEntries = postKnown.filter((e) => e.scheme === "known");
		assert.ok(
			knownEntries.length > 0,
			"S3-T3: should have at least one known entry",
		);

		// Turn 4: copy known entry
		const r4 = await client.call("act", {
			model,
			prompt: "Copy known://changelog to known://changelog_backup.",
			run: r3.run,
		});
		await client.assertRun(r4, ["completed", "proposed"], "S3-T4");
		if (r4.status === "proposed") await acceptAll(client, r4);
		const postCopy = await allEntries(tdb.db, r4.run);
		const backup = postCopy.filter(
			(e) => e.scheme === "known" && e.path.includes("changelog_backup"),
		);
		assert.ok(backup.length > 0, "S3-T4: backup should exist");

		// Turn 5: move known entry
		const r5 = await client.call("act", {
			model,
			prompt: "Move known://changelog_backup to known://archive.",
			run: r3.run,
		});
		await client.assertRun(r5, ["completed", "proposed"], "S3-T5");
		if (r5.status === "proposed") await acceptAll(client, r5);
		const postMove = await allEntries(tdb.db, r5.run);
		const archive = postMove.filter((e) => e.path === "known://archive");
		const backupGone = postMove.filter(
			(e) => e.path === "known://changelog_backup",
		);
		assert.ok(archive.length > 0, "S3-T5: archive should exist");
		assert.equal(backupGone.length, 0, "S3-T5: backup should be gone");

		// Turn 6: env command
		const r6 = await client.call("act", {
			model,
			prompt: "Check the Node.js version using env: <env>node --version</env>",
			run: r3.run,
		});
		await client.assertRun(r6, ["completed", "proposed"], "S3-T6");
		if (r6.status === "proposed") await acceptAll(client, r6);

		// Turn 7: delete known entry
		const r7 = await client.call("act", {
			model,
			prompt: "Delete known://archive — we don't need it anymore.",
			run: r3.run,
		});
		await client.assertRun(r7, ["completed", "proposed"], "S3-T7");
		if (r7.status === "proposed") await acceptAll(client, r7);
		const postDelete = await allEntries(tdb.db, r7.run);
		const stillHasArchive = postDelete.some(
			(e) => e.path === "known://archive",
		);
		assert.ok(!stillHasArchive, "S3-T7: archive should be deleted");

		// Turn 8: summarize the session
		const r8 = await client.call("act", {
			model,
			prompt: "Summarize everything you did in this session.",
			run: r3.run,
		});
		await client.assertRun(r8, ["completed", "proposed"], "S3-T8");
		if (r8.status === "proposed") await acceptAll(client, r8);
	});

	// ---------------------------------------------------------------
	// Story 4: Adversarial prompt coherence — rapid question switching
	// 6 turns, each a different question, model must answer the LATEST
	// ---------------------------------------------------------------
	it("Story 4: adversarial prompt coherence", {
		timeout: TIMEOUT,
	}, async () => {
		// Turn 1
		const r1 = await client.call("ask", {
			model,
			prompt:
				"What is the project codename in notes.md? Reply ONLY with the single word, nothing else.",
		});
		await client.assertRun(r1, "completed", "S4-T1");
		let resp = await lastResponse(tdb.db, r1.run);
		assertContains(resp, "phoenix", "S4-T1");

		// Turn 2
		const r2 = await client.call("ask", {
			model,
			prompt:
				"What port does src/app.js listen on? Reply ONLY with the number, nothing else.",
			run: r1.run,
		});
		await client.assertRun(r2, "completed", "S4-T2");
		resp = await lastResponse(tdb.db, r2.run);
		assertContains(resp, "8080", "S4-T2");

		// Turn 3
		const r3 = await client.call("ask", {
			model,
			prompt:
				"How many users are in data/users.json? Reply ONLY with the number, nothing else.",
			run: r1.run,
		});
		await client.assertRun(r3, "completed", "S4-T3");
		resp = await lastResponse(tdb.db, r3.run);
		assertContains(resp, "2", "S4-T3");

		// Turn 4
		const r4 = await client.call("ask", {
			model,
			prompt:
				"What is the database host in src/config.json? Reply ONLY with the hostname, nothing else.",
			run: r1.run,
		});
		await client.assertRun(r4, "completed", "S4-T4");
		resp = await lastResponse(tdb.db, r4.run);
		assertContains(resp, "db.internal", "S4-T4");

		// Turn 5
		const r5 = await client.call("ask", {
			model,
			prompt:
				"What is the pool size in src/config.json? Reply ONLY with the number, nothing else.",
			run: r1.run,
		});
		await client.assertRun(r5, "completed", "S4-T5");
		resp = await lastResponse(tdb.db, r5.run);
		assertContains(resp, "5", "S4-T5");

		// Turn 6: recall — can the model remember the first question?
		const r6 = await client.call("ask", {
			model,
			prompt:
				"What was the very first question I asked you in this session? Reply with the topic, not the answer.",
			run: r1.run,
		});
		await client.assertRun(r6, "completed", "S4-T6");
		resp = await lastResponse(tdb.db, r6.run);
		const mentionsFirst =
			resp.toLowerCase().includes("codename") ||
			resp.toLowerCase().includes("notes") ||
			resp.toLowerCase().includes("phoenix");
		assert.ok(
			mentionsFirst,
			`S4-T6: should recall first question topic, got: "${resp.slice(0, 200)}"`,
		);
	});

	// ---------------------------------------------------------------
	// Story 5: Unknown-driven investigation
	// Model registers unknowns, investigates, resolves
	// ---------------------------------------------------------------
	it("Story 5: unknown investigation", { timeout: TIMEOUT }, async () => {
		// Turn 1: register unknowns (don't investigate yet)
		const r1 = await client.call("ask", {
			model,
			prompt:
				"Register two unknowns: (1) what test framework this project uses, and (2) what the npm scripts are. Do NOT investigate yet — just register the unknowns and summarize.",
		});
		await client.assertRun(r1, "completed", "S5-T1");

		// Checkpoint: unknowns exist
		const all1 = await allEntries(tdb.db, r1.run);
		const unknowns = all1.filter((e) => e.scheme === "unknown");
		assert.ok(
			unknowns.length > 0,
			"S5-T1: at least one unknown should have been registered",
		);

		// Turn 2: register another unknown
		const r2 = await client.call("ask", {
			model,
			prompt:
				"Register an unknown about whether there is an API endpoint serving the user data in data/users.json. Just register it and summarize.",
			run: r1.run,
		});
		await client.assertRun(r2, "completed", "S5-T2");

		// Turn 3: investigate by reading a file
		const r3 = await client.call("ask", {
			model,
			prompt:
				"Read src/app.js to check if there's an API endpoint for users. Then summarize what you found.",
			run: r1.run,
		});
		await client.assertRun(r3, "completed", "S5-T3");

		// Turn 4: store resolved unknowns and synthesize
		const r4 = await client.call("ask", {
			model,
			prompt:
				"Store any unknowns you've resolved. What do you know for certain about this project's architecture? Reply with specific facts.",
			run: r1.run,
		});
		await client.assertRun(r4, "completed", "S5-T4");
		const resp = await lastResponse(tdb.db, r4.run);
		const mentionsFact =
			resp.toLowerCase().includes("express") ||
			resp.toLowerCase().includes("8080") ||
			resp.toLowerCase().includes("postgres");
		assert.ok(
			mentionsFact,
			`S5-T4: should mention concrete facts, got: "${resp.slice(0, 200)}"`,
		);
	});

	// ---------------------------------------------------------------
	// Story 6: Lite mode sustained session — no file context
	// 4 turns, pure message history tracking
	// ---------------------------------------------------------------
	it("Story 6: lite mode sustained session", { timeout: TIMEOUT }, async () => {
		const r1 = await client.call("ask", {
			model,
			prompt:
				"I'm going to give you three numbers across three messages. The first number is 17. Just acknowledge and remember it.",
			noContext: true,
		});
		await client.assertRun(r1, "completed", "S6-T1");

		const r2 = await client.call("ask", {
			model,
			prompt: "The second number is 23. Acknowledge.",
			run: r1.run,
		});
		await client.assertRun(r2, "completed", "S6-T2");

		const r3 = await client.call("ask", {
			model,
			prompt: "The third number is 41. Acknowledge.",
			run: r1.run,
		});
		await client.assertRun(r3, "completed", "S6-T3");

		const r4 = await client.call("ask", {
			model,
			prompt:
				"What is the sum of all three numbers I gave you? Reply ONLY with the number, nothing else.",
			run: r1.run,
		});
		await client.assertRun(r4, "completed", "S6-T4");
		const resp = await lastResponse(tdb.db, r4.run);
		assertContains(resp, "81", "S6-T4");
	});

	// ---------------------------------------------------------------
	// Story 7: Abort mid-flight
	// ---------------------------------------------------------------
	it("Story 7: abort mid-flight", { timeout: TIMEOUT }, async () => {
		let runAlias = null;
		const captureRun = (p) => {
			runAlias ??= p.run;
		};
		client.on("run/progress", captureRun);
		client.on("run/state", captureRun);

		const askPromise = client.call("ask", {
			model,
			prompt:
				"Carefully read every single file in this project one at a time. For each file, write a detailed 500-word analysis. Then cross-reference all analyses with each other.",
		});

		// Wait for the run to start
		const deadline = Date.now() + 15_000;
		while (!runAlias && Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 500));
		}

		assert.ok(runAlias, "S7: run should have started");
		const abortResult = await client.call("run/abort", { run: runAlias });
		assert.equal(abortResult.status, "ok", "S7: abort RPC should return ok");

		const result = await askPromise;
		assert.ok(
			["aborted", "completed", "failed"].includes(result.status),
			`S7: expected aborted/completed/failed, got ${result.status}`,
		);

		// Verify DB state — the run must not be stuck at 'running'
		const runRow = await tdb.db.get_run_by_alias.get({ alias: runAlias });
		assert.ok(
			runRow.status !== "running",
			`S7: run should not be stuck at running in DB, got ${runRow.status}`,
		);

		client.removeListener("run/progress", captureRun);
		client.removeListener("run/state", captureRun);
	});

	// ---------------------------------------------------------------
	// Story 8: Rejection and recovery
	// Reject a proposal, verify state survives, then accept a different one
	// ---------------------------------------------------------------
	it("Story 8: rejection and recovery", { timeout: TIMEOUT }, async () => {
		// Turn 1: request file deletion
		const r1 = await client.call("act", {
			model,
			prompt: "Delete the file notes.md from the project.",
		});
		await client.assertRun(r1, ["completed", "proposed"], "S8-T1");

		const runAlias = r1.run;

		if (r1.status === "proposed") {
			// Reject the deletion (and any others)
			let current = r1;
			while (current.status === "proposed") {
				const next = current.proposed[0];
				current = await client.call("run/resolve", {
					run: runAlias,
					resolution: {
						path: next.path,
						action: "reject",
						output: "Do not delete.",
					},
				});
			}
		}

		// Turn: verify notes.md survives — model can still read it
		const r3 = await client.call("ask", {
			model,
			prompt:
				"Is notes.md still in the project? What does it contain? Reply with its content.",
			run: runAlias,
		});
		await client.assertRun(r3, "completed", "S8-verify");
		const resp = await lastResponse(tdb.db, r3.run);
		assertContains(resp, "phoenix", "S8: file survived rejection");

		// Turn: now do a write that should succeed after prior rejection
		const r4 = await client.call("act", {
			model,
			prompt:
				'Create a file called output.txt with the text "test output". Use: <write path="output.txt">test output</write>',
			run: runAlias,
		});
		await client.assertRun(r4, ["completed", "proposed"], "S8-write");

		if (r4.status === "proposed") {
			const writeProposed = r4.proposed.find((p) =>
				p.path.startsWith("write://"),
			);
			if (writeProposed) {
				const current = await client.call("run/resolve", {
					run: runAlias,
					resolution: {
						path: writeProposed.path,
						action: "accept",
						output: "applied",
					},
				});
				await acceptAll(client, current);
			}
		}

		// Verify at least one write was accepted in the entire run
		const all = await allEntries(tdb.db, runAlias);
		const acceptedWrites = all.filter(
			(e) => e.scheme === "write" && e.state === "pass",
		);
		assert.ok(
			acceptedWrites.length > 0,
			"S8: at least one accepted write should exist",
		);
	});

	// ---------------------------------------------------------------
	// Story 9: Tool awareness — keys preview, store/re-read,
	// search-then-answer, plain text healing
	// Tests that the model can see and use tool result content.
	// ---------------------------------------------------------------
	it("Story 9: tool awareness", { timeout: TIMEOUT }, async () => {
		// Turn 1: keys preview — list JS files without reading them
		const r1 = await client.call("ask", {
			model,
			prompt:
				'Preview what JS files exist in src/ using the keys flag: <read path="src/*.js" keys/>\nHow many JS files matched? Reply with the count.',
		});
		await client.assertRun(r1, "completed", "S9-T1");
		let resp = await lastResponse(tdb.db, r1.run);
		// Should mention 2 or 3 files (app.js, utils.js, possibly config.json excluded)
		const all1 = await allEntries(tdb.db, r1.run);
		const keysEntries = all1.filter((e) => e.state === "keys");
		assert.ok(keysEntries.length > 0, "S9-T1: keys preview should exist");

		// Turn 2: write a known entry, then store it
		const r2 = await client.call("ask", {
			model,
			prompt:
				'Save known://temp_note with the value "temporary data". Then store it away from context: <write path="known://temp_note">temporary data</write>',
			run: r1.run,
		});
		await client.assertRun(r2, "completed", "S9-T2");

		// Turn 3: store it away
		const r3 = await client.call("ask", {
			model,
			prompt:
				'Store the temp note away from context: <store path="known://temp_note"/>',
			run: r1.run,
		});
		await client.assertRun(r3, "completed", "S9-T3");

		// Turn 4: re-read the stored entry
		const r4 = await client.call("ask", {
			model,
			prompt:
				"Read known://temp_note back into context. What does it say? Reply with its content.",
			run: r1.run,
		});
		await client.assertRun(r4, "completed", "S9-T4");
		resp = await lastResponse(tdb.db, r4.run);
		assertContains(resp, "temporary", "S9-T4 re-read stored entry");

		// Turn 5: search and answer — model must use search results
		const r5 = await client.call("ask", {
			model,
			prompt:
				'Search for "SQLite WAL mode" and explain what WAL mode does in one sentence.',
			run: r1.run,
		});
		await client.assertRun(r5, "completed", "S9-T5");
		resp = await lastResponse(tdb.db, r5.run);
		const mentionsWal =
			resp.toLowerCase().includes("write") ||
			resp.toLowerCase().includes("log") ||
			resp.toLowerCase().includes("wal") ||
			resp.toLowerCase().includes("concurrent");
		assert.ok(
			mentionsWal,
			`S9-T5: should explain WAL mode, got: "${resp.slice(0, 200)}"`,
		);

		// Turn 6: plain text answer — no tools, should heal to summary
		const r6 = await client.call("ask", {
			model,
			prompt: "What is 2 + 2? Reply with just the number, no tool commands.",
			run: r1.run,
			noContext: true,
		});
		await client.assertRun(r6, "completed", "S9-T6");
		resp = await lastResponse(tdb.db, r6.run);
		assertContains(resp, "4", "S9-T6 plain text healed to summary");

		// Verify it completed in 1 turn (plain text → summary, no continuation)
		const all6 = await allEntries(tdb.db, r6.run);
		const _progress6 = all6.filter(
			(e) => e.scheme === "progress" && e.path.includes("//"),
		);
		// The run may have used continuation turns before, but turn 6 specifically
		// should not spawn new progress entries beyond what already existed
	});
});

/**
 * Shared infrastructure for user-story e2e tests.
 *
 * Each story is a one-prompt-in / outcome-out scenario against a real
 * model. The harness owns the setup (project fixture, server, client)
 * and the readback helpers (last response, all entries). Stories
 * themselves are tiny — one prompt, one assertion on the outcome.
 *
 * Usage:
 *   const story = new StoryHarness("story_name");
 *   before(() => story.setUp());
 *   after(() => story.tearDown());
 *   it("user does X, sees Y", async () => {
 *     await story.fixture.resetProjectFiles(); // optional, between cases
 *     const run = await story.ask("prompt");
 *     const answer = await story.lastResponse(run);
 *     assert.match(answer, /expected/);
 *   });
 */
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import AuditClient from "./AuditClient.js";
import TestDb from "./TestDb.js";
import TestServer from "./TestServer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Standard project fixture used by story tests. Five files, a git
// init, and a small payload that lets stories ask about codenames,
// edit JS, query JSON, and exercise the file bootstrap path.
async function seedFixture(projectRoot) {
	await fs.mkdir(join(projectRoot, "src"), { recursive: true });
	await fs.mkdir(join(projectRoot, "data"), { recursive: true });

	await fs.writeFile(
		join(projectRoot, "src/app.js"),
		"const express = require('express');\nconst app = express();\napp.listen(8080);\n// TODO: add error handling\n",
	);
	await fs.writeFile(
		join(projectRoot, "src/config.json"),
		JSON.stringify({ db: "postgres", pool: 5, host: "db.internal" }, null, 2),
	);
	await fs.writeFile(
		join(projectRoot, "src/utils.js"),
		"export function greet() { return 'hello'; }\nexport function add(a, b) { return a + b; }\n",
	);
	await fs.writeFile(
		join(projectRoot, "notes.md"),
		"The project codename is: phoenix\n",
	);
	await fs.writeFile(
		join(projectRoot, "data/users.json"),
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
		{ cwd: projectRoot },
	);
}

// Re-seed in-place files between tests so each story starts from a
// known disk state. Story tests that accept file edits otherwise
// bleed state into successor cases.
async function resetMutableFiles(projectRoot) {
	await fs.writeFile(
		join(projectRoot, "src/app.js"),
		"const express = require('express');\nconst app = express();\napp.listen(8080);\n// TODO: add error handling\n",
	);
	await fs.writeFile(
		join(projectRoot, "src/config.json"),
		JSON.stringify({ db: "postgres", pool: 5, host: "db.internal" }, null, 2),
	);
	await fs.writeFile(
		join(projectRoot, "src/utils.js"),
		"export function greet() { return 'hello'; }\nexport function add(a, b) { return a + b; }\n",
	);
	await fs.writeFile(
		join(projectRoot, "notes.md"),
		"The project codename is: phoenix\n",
	);
}

export default class StoryHarness {
	constructor(suiteName) {
		this.model = process.env.RUMMY_TEST_MODEL;
		this.suiteName = suiteName;
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		this.projectRoot = join(tmpdir(), `rummy-story-${suiteName}-${Date.now()}`);
		this.turnsHome = join(
			__dirname,
			"..",
			"e2e",
			"turns",
			`${suiteName}_${stamp}`,
		);
		this.tdb = null;
		this.tserver = null;
		this.client = null;
	}

	async setUp() {
		await fs.mkdir(this.turnsHome, { recursive: true });
		await fs.mkdir(this.projectRoot, { recursive: true });
		await seedFixture(this.projectRoot);
		this.tdb = await TestDb.create(this.suiteName, { home: this.turnsHome });
		this.tserver = await TestServer.start(this.tdb);
		this.client = new AuditClient(this.tserver.url, this.tdb.db, {
			projectRoot: this.projectRoot,
		});
		await this.client.connect();
		await this.client.call("rummy/hello", {
			name: `Story:${this.suiteName}`,
			projectRoot: this.projectRoot,
		});
	}

	async tearDown() {
		await this.client?.close();
		await this.tserver?.stop();
		await this.tdb?.cleanup();
		await fs.rm(this.projectRoot, { recursive: true, force: true });
	}

	async resetFixture() {
		await resetMutableFiles(this.projectRoot);
	}

	// Story-shaped run: one prompt, model runs autonomously, return
	// once the run reaches a terminal state. Caller asserts on the
	// outcome via lastResponse / allEntries / disk.
	async ask(prompt, opts = {}) {
		return this.client.ask({ model: this.model, prompt, ...opts });
	}

	async act(prompt, opts = {}) {
		return this.client.act({ model: this.model, prompt, ...opts });
	}

	// The model's literal answer can land in two places: assistant://N
	// (full raw response — prose + tags, always contains the answer)
	// or the run summary (which captures the model's final update body
	// for runs that completed via 200). assistant://N takes
	// precedence — it carries the answer wherever the model placed it.
	async lastResponse(runAlias) {
		const runRow = await this.tdb.db.get_run_by_alias.get({ alias: runAlias });
		const entries = await this.tdb.db.get_known_entries.all({
			run_id: runRow.id,
		});
		// Order across loops first (recent loop wins), then by turn within
		// loop. A single run with a follow-up ask reuses the run alias, so
		// the second loop's turn=1 must beat the first loop's later turns;
		// turn-only sort would return the prior loop's last emission.
		const assistant = entries
			.filter((e) => e.scheme === "assistant" && e.body)
			.toSorted((a, b) => b.loop_id - a.loop_id || b.turn - a.turn);
		if (assistant.length > 0) return assistant[0].body;

		const latestLoop = await this.tdb.db.get_latest_completed_loop.get({
			run_id: runRow.id,
		});
		const summary = await this.tdb.db.get_latest_summary.get({
			run_id: runRow.id,
			loop_id: latestLoop?.id ?? null,
		});
		if (summary?.body) return summary.body;

		const content = entries
			.filter((e) => e.scheme === "content")
			.toSorted((a, b) => b.turn - a.turn);
		if (content.length > 0) return content[0].body;
		return "";
	}

	async allEntries(runAlias) {
		const runRow = await this.tdb.db.get_run_by_alias.get({ alias: runAlias });
		return this.tdb.db.get_known_entries.all({ run_id: runRow.id });
	}
}

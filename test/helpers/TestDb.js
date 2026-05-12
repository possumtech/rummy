import { readdirSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import SqlRite from "@possumtech/sqlrite";
import Entries from "../../src/agent/Entries.js";
import createHooks from "../../src/hooks/Hooks.js";
import { initPlugins, registerPlugins } from "../../src/plugins/index.js";

// Scoped wrapper around Entries that binds (runId, loopId) — the DB
// contract requires both on every per-loop write, but threading them
// through every test call is a DRY violation. Tests get a store
// that already knows its (runId, loopId) context; they call .set,
// .rm, .logPath etc. against entry semantics, not schema mechanics.
function scopedStore(db, runId, loopId) {
	const entries = new Entries(db);
	return {
		set: (args) => entries.set({ runId, loopId, ...args }),
		rm: (args) => entries.rm({ runId, ...args }),
		get: (args) => entries.get({ runId, ...args }),
		update: (args) => entries.update({ runId, loopId, ...args }),
		cp: (args) => entries.cp({ runId, loopId, ...args }),
		mv: (args) => entries.mv({ runId, loopId, ...args }),
		getBody: (path) => entries.getBody(runId, path),
		getState: (path) => entries.getState(runId, path),
		getAttributes: (path) => entries.getAttributes(runId, path),
		getEntriesByPattern: (pattern, filter) =>
			entries.getEntriesByPattern(runId, pattern, filter),
		getUnresolved: () => entries.getUnresolved(runId),
		getFileEntries: () => entries.getFileEntries(runId),
		logPath: (turn, action) => entries.logPath(runId, loopId, turn, action),
		nextTurn: () => entries.nextTurn(runId, loopId),
		nextSeq: (turn) => entries.nextSeq(runId, loopId, turn),
		// Expose runId/loopId for tests that need the raw IDs (DB queries
		// outside the entries API).
		runId,
		loopId,
	};
}

const functionsDir = fileURLToPath(
	new URL("../../src/sql/functions", import.meta.url),
);
const sqlFunctions = readdirSync(functionsDir)
	.filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
	.map((f) => join(functionsDir, f));

const DIAG_DIR = join(tmpdir(), "rummy_test_diag");

async function cleanOldTestDbs() {
	const dir = tmpdir();
	const entries = await fs.readdir(dir);
	const stale = entries.filter(
		(f) => f.startsWith("rummy_test_") && f.endsWith(".db"),
	);
	await Promise.all(
		stale.flatMap((f) => [
			fs.unlink(join(dir, f)).catch(() => {}),
			fs.unlink(join(dir, `${f}-shm`)).catch(() => {}),
			fs.unlink(join(dir, `${f}-wal`)).catch(() => {}),
		]),
	);
	await fs.mkdir(DIAG_DIR, { recursive: true });
}

export default class TestDb {
	constructor(db, dbPath, hooks, suiteName) {
		this.db = db;
		this.dbPath = dbPath;
		this.hooks = hooks;
		this.suiteName = suiteName;
	}

	static async create(suiteName = "test", options = {}) {
		await cleanOldTestDbs();
		const dbPath = join(
			tmpdir(),
			`rummy_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`,
		);
		return TestDb.#open(dbPath, suiteName, options);
	}

	static async createAt(dbPath, suiteName = "test", options = {}) {
		return TestDb.#open(dbPath, suiteName, options);
	}

	static async #open(dbPath, suiteName, options = {}) {
		// Set RUMMY_HOME BEFORE registerPlugins so telemetry's constructor
		// reads it. Setting it after plugin construction (e.g. in
		// TestServer.start) is too late — telemetry locks in its turnsDir
		// at construction and silently never writes turn dumps.
		if (options.home) {
			process.env.RUMMY_HOME = options.home;
		}
		const entrySizeMax =
			options.entrySizeMax !== undefined
				? options.entrySizeMax
				: Number(process.env.RUMMY_ENTRY_SIZE_MAX);
		const db = await SqlRite.open({
			path: dbPath,
			dir: ["migrations", "src"],
			functions: sqlFunctions,
			params: {
				mmap_size: 0,
				entry_size_max: entrySizeMax,
			},
		});
		const hooks = createHooks();
		const pluginsDir = join(
			dirname(fileURLToPath(import.meta.url)),
			"../../src/plugins",
		);
		const pluginInstances = await registerPlugins([pluginsDir], hooks);
		await initPlugins(db, hooks, pluginInstances);
		return new TestDb(db, dbPath, hooks, suiteName);
	}

	async seedRun({
		name = "Test",
		projectRoot = "/tmp/test",
		alias = "test_1",
	} = {}) {
		const project = await this.db.upsert_project.get({
			name,
			project_root: projectRoot,
			config_path: null,
		});
		const run = await this.db.create_run.get({
			project_id: project.id,
			parent_run_id: null,
			model: null,
			alias,
			temperature: null,
			persona: null,
			context_limit: null,
		});
		// Path generation is per-loop now (log://<L>/<T>/<S>/<action>);
		// every test that calls nextTurn/logPath needs a loop to scope
		// its counters. Seed a default loop AND claim it (status=102 =
		// active) so plugins that gate on the active loop (FileScanner,
		// budget grinder, etc.) see a real one.
		const loop = await this.db.enqueue_loop.get({
			run_id: run.id,
			sequence: 1,
			mode: "act",
			model: null,
			prompt: "",
			config: JSON.stringify({}),
		});
		await this.db.claim_next_loop.get({ run_id: run.id });
		// `store` is the DRY shape: it captures (runId, loopId) so tests
		// can call .set/.rm/.logPath etc. without re-stating the contract
		// dimensions on every call. Schema enforces NOT NULL on loop_id;
		// the scoped store fills it from the seed context.
		const store = scopedStore(this.db, run.id, loop.id);
		return {
			projectId: project.id,
			runId: run.id,
			loopId: loop.id,
			store,
		};
	}

	async seedModel({ alias = "test_model", actual = "test/model" } = {}) {
		const model = await this.db.upsert_model.get({
			alias,
			actual,
			context_length: 32000,
		});
		return { modelId: model.id };
	}

	async cleanup() {
		await this.db.close();
		// If DB is in a temp directory, persist to diag and delete.
		// Layout matches the tbench task-dir shape so bin/digest.js
		// can process the captured DB the same way it processes a task
		// container's `agent/rummy.db`. See AGENTS.md "Sweep analysis"
		// section. If DB is in a results directory (createAt), leave it in place.
		const inTmp = this.dbPath.startsWith(tmpdir());
		if (inTmp) {
			const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
			const taskDir = join(DIAG_DIR, `${this.suiteName}_${ts}`);
			const agentDir = join(taskDir, "agent");
			await fs.mkdir(agentDir, { recursive: true }).catch(() => {});
			await fs
				.copyFile(this.dbPath, join(agentDir, "rummy.db"))
				.catch(() => {});
			await fs.unlink(this.dbPath).catch(() => {});
			await fs.unlink(`${this.dbPath}-shm`).catch(() => {});
			await fs.unlink(`${this.dbPath}-wal`).catch(() => {});
		}
	}
}

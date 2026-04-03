import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import { join } from "node:path";

function hashContent(content) {
	return crypto.createHash("sha256").update(content).digest("hex");
}

export default class FileScanner {
	#knownStore;
	#db;
	#hooks;

	constructor(knownStore, db, hooks) {
		this.#knownStore = knownStore;
		this.#db = db;
		this.#hooks = hooks;
	}

	/**
	 * Scan the project and sync file entries across all active runs.
	 * Uses filesystem mtime to skip unchanged files (no read, no hash).
	 */
	async scan(
		projectPath,
		projectId,
		mappableFiles,
		currentTurn = 0,
		rummy = null,
	) {
		const activeRuns = await this.#db.get_active_runs.all({
			project_id: projectId,
		});
		if (activeRuns.length === 0) return;

		// Load file constraints for this project
		const constraintRows = await this.#db.get_file_constraints.all({
			project_id: projectId,
		});
		const constraints = new Map(
			constraintRows.map((c) => [c.pattern, c.visibility]),
		);

		// Include activated files that aren't in the git file list
		for (const [pattern, visibility] of constraints) {
			if (visibility === "active" && !mappableFiles.includes(pattern)) {
				mappableFiles.push(pattern);
			}
		}

		// Stat all files concurrently (no content reads), skip ignored
		const diskStats = new Map();
		const statResults = await Promise.all(
			mappableFiles
				.filter((relPath) => constraints.get(relPath) !== "ignore")
				.map(async (relPath) => {
					const fullPath = join(projectPath, relPath);
					try {
						const stat = await fs.stat(fullPath);
						if (!stat.isFile()) return null;
						return { relPath, mtime: stat.mtimeMs, fullPath };
					} catch {
						return null;
					}
				}),
		);
		for (const entry of statResults) {
			if (entry)
				diskStats.set(entry.relPath, {
					mtime: entry.mtime,
					fullPath: entry.fullPath,
				});
		}

		for (const run of activeRuns) {
			await this.#syncRun(
				run.id,
				projectPath,
				diskStats,
				currentTurn,
				constraints,
				rummy,
			);
		}
	}

	async #syncRun(
		runId,
		_projectPath,
		diskStats,
		currentTurn,
		constraints,
		rummy,
	) {
		const existing = await this.#knownStore.getFileEntries(runId);
		const fileKeys = new Map();
		for (const entry of existing) {
			fileKeys.set(entry.path, entry);
		}

		const changedPaths = [];

		for (const [relPath, { mtime, fullPath }] of diskStats) {
			const entry = fileKeys.get(relPath);
			fileKeys.delete(relPath);

			// Skip if mtime hasn't changed since last scan
			const storedMtime = entry?.updated_at
				? new Date(entry.updated_at).getTime()
				: 0;
			if (entry && Math.abs(mtime - storedMtime) < 1000) continue;

			// mtime changed — read and hash
			let content;
			try {
				content = readFileSync(fullPath, "utf8");
			} catch {
				continue;
			}
			const hash = hashContent(content);

			// Skip if hash matches (mtime changed but content didn't)
			if (entry?.hash === hash) continue;

			changedPaths.push(relPath);

			const constraint = constraints.get(relPath) || null;
			const state = constraint === "active" ? "full" : entry?.state || "index";

			await this.#knownStore.upsert(
				runId,
				currentTurn,
				relPath,
				content,
				state,
				{
					hash,
					attributes: { constraint },
					updatedAt: new Date(mtime).toISOString(),
				},
			);
		}

		// Emit entry.changed for all changed files
		if (changedPaths.length > 0 && this.#hooks?.entry?.changed) {
			await this.#hooks.entry.changed.emit({
				rummy,
				runId,
				turn: currentTurn,
				paths: changedPaths,
			});
		}

		// New files that aren't in the store yet
		for (const [relPath, { mtime, fullPath }] of diskStats) {
			if (fileKeys.has(relPath)) continue;
			const alreadyProcessed = changedPaths.includes(relPath);
			if (alreadyProcessed) continue;

			// Check if it was already handled above (existed + unchanged)
			const entry = existing.find((e) => e.path === relPath);
			if (entry) continue;

			// Truly new file
			let content;
			try {
				content = readFileSync(fullPath, "utf8");
			} catch {
				continue;
			}
			const constraint = constraints.get(relPath) || null;
			await this.#knownStore.upsert(
				runId,
				currentTurn,
				relPath,
				content,
				constraint === "active" ? "full" : "index",
				{
					hash: hashContent(content),
					attributes: { constraint },
					updatedAt: new Date(mtime).toISOString(),
				},
			);
		}

		// Remove files deleted from disk
		for (const [relPath] of fileKeys) {
			await this.#knownStore.remove(runId, relPath);
		}
	}
}

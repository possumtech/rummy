import { isAbsolute, relative } from "node:path";

/**
 * File plugin: projections and constraints for filesystem entries.
 *
 * Bare file paths (src/app.js) have scheme=NULL in the DB because
 * schemeOf() only recognizes "://" patterns. The schemes table has
 * a "file" entry so v_model_context can JOIN via COALESCE(scheme, 'file').
 * This is the one exception to "every scheme has a plugin owner" —
 * the file plugin owns the NULL scheme through the "file" registry entry.
 */
export default class File {
	#core;

	constructor(core) {
		this.#core = core;
		// "file" scheme covers bare paths (scheme IS NULL in DB)
		core.registerScheme({ category: "file" });
		core.registerScheme({ name: "http", category: "file" });
		core.registerScheme({ name: "https", category: "file" });
		core.on("full", this.full.bind(this));
		core.on("summary", this.summary.bind(this));

		// Identity projections for schemes that just pass through body
		for (const scheme of ["known", "skill", "ask", "act", "progress"]) {
			core.hooks.tools.onView(scheme, (entry) => entry.body);
		}
	}

	full(entry) {
		return entry.body;
	}

	summary(entry) {
		return entry.body;
	}

	static async activate(
		db,
		knownStore,
		projectId,
		pattern,
		visibility = "active",
	) {
		const path = await normalizePath(db, projectId, pattern);
		if (!path) return { status: "ok" };

		await db.upsert_file_constraint.run({
			project_id: projectId,
			pattern: path,
			visibility,
		});

		const runs = await db.get_all_runs.all({ project_id: projectId });
		if (visibility === "active") {
			for (const run of runs) {
				await knownStore.promoteByPattern(run.id, path, null, 0);
			}
		} else if (visibility === "ignore") {
			for (const run of runs) {
				await knownStore.demoteByPattern(run.id, path, null);
			}
		}

		return { status: "ok" };
	}

	static async ignore(db, knownStore, projectId, pattern) {
		return File.activate(db, knownStore, projectId, pattern, "ignore");
	}

	static async drop(db, projectId, pattern) {
		const path = await normalizePath(db, projectId, pattern);
		if (!path) return { status: "ok" };

		await db.delete_file_constraint.run({
			project_id: projectId,
			pattern: path,
		});

		return { status: "ok" };
	}
}

async function normalizePath(db, projectId, path) {
	if (!isAbsolute(path)) return path;
	const project = await db.get_project_by_id.get({ id: projectId });
	if (!project) return path;
	return relative(project.project_root, path);
}

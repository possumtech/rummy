import { isAbsolute, relative } from "node:path";

/**
 * File plugin — owns everything about files on disk as entries.
 * Projections, file constraints, and constraint RPCs.
 */
export default class FilePlugin {
	static register(hooks) {
		// Projections for schemes that appear in the model view
		hooks.tools.onProject("file", (entry) => entry.body);
		hooks.tools.onProject("known", (entry) => entry.body);
		hooks.tools.onProject("skill", (entry) => entry.body);
		hooks.tools.onProject("ask", (entry) => entry.body);
		hooks.tools.onProject("act", (entry) => entry.body);
		hooks.tools.onProject("progress", (entry) => entry.body);
	}

	// --- File constraint methods (called by RPC handlers) ---

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

		if (visibility === "ignore") {
			const runs = await db.get_all_runs.all({ project_id: projectId });
			for (const run of runs) {
				await knownStore.demoteByPattern(run.id, path, null);
			}
		}

		return { status: "ok" };
	}

	static async ignore(db, knownStore, projectId, pattern) {
		return FilePlugin.activate(db, knownStore, projectId, pattern, "ignore");
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

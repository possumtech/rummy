import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Dynamically loads and registers plugins from provided directories.
 */
export async function registerPlugins(dirs = [], hooks) {
	const uniqueDirs = [...new Set(dirs.map((d) => join(d)))];

	for (const dir of uniqueDirs) {
		await scanDir(dir, hooks, true); // Root level
	}
}

async function scanDir(dir, hooks, isRoot = false) {
	if (!existsSync(dir)) return;

	const dirStats = statSync(dir);
	if (!dirStats.isDirectory()) {
		if (process.env.SNORE_DEBUG === "true") {
			console.error(
				`[SNORE] Cannot scan plugin directory (not a directory): ${dir}`,
			);
		}
		return;
	}

	let entries;
	try {
		entries = readdirSync(dir);
	} catch (err) {
		if (process.env.SNORE_DEBUG === "true") {
			console.error(`[SNORE] Failed to read directory ${dir}:`, err.message);
		}
		return;
	}

	for (const name of entries) {
		if (name.endsWith(".test.js")) continue;

		const fullPath = join(dir, name);
		let stats;
		try {
			stats = statSync(fullPath);
		} catch (_err) {
			continue;
		}

		if (stats.isFile() && name.endsWith(".js")) {
			if (isRoot) {
				if (name !== "index.js") await loadPlugin(fullPath, hooks);
			} else {
				const folderName = basename(dir);
				if (name === "index.js" || name === `${folderName}.js`) {
					await loadPlugin(fullPath, hooks);
				}
			}
		} else if (stats.isDirectory()) {
			await scanDir(fullPath, hooks, false);
		}
	}
}

async function loadPlugin(filePath, hooks) {
	try {
		const url = pathToFileURL(filePath).href;
		const { default: Plugin } = await import(url);
		if (typeof Plugin?.register === "function") {
			Plugin.register(hooks);
		}
	} catch (err) {
		if (process.env.SNORE_DEBUG === "true") {
			console.error(`[SNORE] Plugin load failed at ${filePath}:`, err.message);
		}
	}
}

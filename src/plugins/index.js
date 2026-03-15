import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import HookRegistry from "../core/HookRegistry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Dynamically loads and registers all plugins found in the provided directories.
 * @param {string[]} dirs - Array of absolute paths to scan for plugins.
 */
export async function registerPlugins(dirs = [__dirname]) {
	const hooks = HookRegistry.instance;

	for (const dir of dirs) {
		if (!existsSync(dir)) continue;

		const files = readdirSync(dir);
		for (const file of files) {
			if (file.endsWith("Plugin.js")) {
				try {
					// Use pathToFileURL to handle absolute paths on all platforms (inc Windows)
					const pluginPath = pathToFileURL(join(dir, file)).href;
					const { default: Plugin } = await import(pluginPath);

					if (typeof Plugin.register === "function") {
						Plugin.register(hooks);
					}
				} catch (err) {
					console.error(
						`[SNORE] Failed to load plugin ${file} from ${dir}:`,
						err.message,
					);
				}
			}
		}
	}
}

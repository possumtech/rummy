import { readFileSync } from "node:fs";
import { extname, join } from "node:path";

let Antlrmap = null;
let antlrmapSupported = null;
try {
	Antlrmap = (await import("@possumtech/antlrmap")).default;
	antlrmapSupported = new Set(Object.keys(Antlrmap.extensions));
} catch {
	// antlrmap not installed — ctags only
}

let CtagsExtractor = null;
try {
	CtagsExtractor = (await import("../../agent/CtagsExtractor.js")).default;
} catch {
	// CtagsExtractor unavailable
}

/**
 * SymbolsPlugin: default symbol extraction via antlrmap (ANTLR4 grammars)
 * with ctags fallback. Replace this plugin to use tree-sitter or any other
 * symbol extraction strategy.
 *
 * Filter: hooks.file.symbols
 * Input:  [] (empty array)
 * Context: { paths, projectPath }
 *   - paths: string[] of relative file paths that changed
 *   - projectPath: string, absolute project root
 * Output: Map<string, symbol[]> where symbol = { name, kind?, params?, line?, endLine? }
 */
export default class SymbolsPlugin {
	static register(hooks) {
		hooks.file.symbols.addFilter(async (symbolMap, { paths, projectPath }) => {
			const result = symbolMap instanceof Map ? symbolMap : new Map();
			const antlrmap = Antlrmap ? new Antlrmap() : null;
			const ctagsQueue = [];

			for (const relPath of paths) {
				if (result.has(relPath)) continue;
				const ext = extname(relPath);

				if (antlrmap && antlrmapSupported?.has(ext)) {
					try {
						const content = readFileSync(join(projectPath, relPath), "utf8");
						const symbols = await antlrmap.mapSource(content, ext);
						if (symbols?.length > 0) {
							result.set(relPath, symbols);
							continue;
						}
					} catch {
						// Fall through to ctags
					}
				}
				ctagsQueue.push(relPath);
			}

			if (ctagsQueue.length > 0 && CtagsExtractor) {
				const extractor = new CtagsExtractor(projectPath);
				const ctagsResults = extractor.extract(ctagsQueue);
				for (const [path, symbols] of ctagsResults) {
					if (symbols.length > 0) result.set(path, symbols);
				}
			}

			return result;
		}, 50);
	}
}

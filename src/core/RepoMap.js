import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, extname } from "node:path";
import SymbolExtractor from "./SymbolExtractor.js";

export default class RepoMap {
	#ctx;
	#hdExtractor;

	constructor(projectContext) {
		this.#ctx = projectContext;
		this.#hdExtractor = new SymbolExtractor();
	}

	/**
	 * Pass 1: Build/Update the Global Tag Index (Persistent Data).
	 * This only contains definitions.
	 * @returns {Promise<Object[]>} - Flat list of { path, symbols }
	 */
	async updateIndex() {
		const mappableFiles = await this.#ctx.getMappableFiles();
		const index = [];
		const ctagsQueue = [];

		for (const relPath of mappableFiles) {
			const ext = extname(relPath).slice(1);
			let extraction = null;

			try {
				const content = readFileSync(join(this.#ctx.root, relPath), "utf8");
				extraction = this.#hdExtractor.extract(content, ext);
			} catch { /* Fallback */ }

			if (extraction) {
				index.push({
					path: relPath,
					symbols: extraction.definitions,
					source: "hd",
				});
			} else {
				ctagsQueue.push(relPath);
			}
		}

		if (ctagsQueue.length > 0) {
			const ctagsResults = this.#generateCtags(ctagsQueue);
			index.push(...ctagsResults);
		}

		return index;
	}

	/**
	 * Pass 2: Render a Dynamic Perspective (Session Logic).
	 * Applies the "Hot/Cold" lens to the provided index.
	 * @param {Object[]} index - The Global Tag Index from the DB.
	 * @param {string[]} activeFiles - Files currently in the Agent context.
	 * @returns {Object} - The context-aware RepoMap.
	 */
	renderPerspective(index, activeFiles = []) {
		const globalReferences = new Set();
		
		// 1. Extract references from Active Files to determine proximity
		for (const relPath of activeFiles) {
			try {
				const ext = extname(relPath).slice(1);
				const content = readFileSync(join(this.#ctx.root, relPath), "utf8");
				const extraction = this.#hdExtractor.extract(content, ext);
				if (extraction?.references) {
					for (const ref of extraction.references) globalReferences.add(ref);
				}
			} catch { /* Non-HD or unreadable */ }
		}

		// 2. Map every file in the index through the lens
		const files = index.map((entry) => {
			const isActive = activeFiles.includes(entry.path);
			const isReferenced = entry.symbols.some(s => globalReferences.has(s.name));
			const isHot = isActive || isReferenced;

			const processedSymbols = entry.symbols.map((s) => {
				if (isHot) return s;
				// Cold Mode: Strip signatures and lines
				const { params, line, ...cold } = s;
				return cold;
			});

			return {
				path: entry.path,
				mode: isHot ? "hot" : "cold",
				symbols: processedSymbols,
				source: entry.source
			};
		});

		return { files };
	}

	#generateCtags(paths) {
		const result = spawnSync(
			"ctags",
			["--output-format=json", "--fields=+n", "-f", "-", ...paths],
			{ cwd: this.#ctx.root, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
		);

		if (result.status !== 0) return [];

		const tags = result.stdout.split("\n").filter(Boolean).map(l => JSON.parse(l));
		const grouped = new Map();
		for (const path of paths) grouped.set(path, []);

		for (const tag of tags) {
			const symbols = grouped.get(tag.path);
			if (symbols) {
				symbols.push({
					name: tag.name,
					type: tag.kind,
					line: tag.line,
					source: "standard"
				});
			}
		}

		return Array.from(grouped.entries()).map(([path, symbols]) => ({
			path,
			symbols,
			source: "standard"
		}));
	}
}

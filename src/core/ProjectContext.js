import GitProvider from "./GitProvider.js";

export const FileState = {
	INVISIBLE: "invisible",
	IGNORED: "ignored",
	MAPPABLE: "mappable",
	MAPPED: "mapped",
	READ_ONLY: "read_only",
	ACTIVE: "active",
};

export default class ProjectContext {
	#root;
	#isGit = false;
	#trackedFiles = new Set();
	#visibilityMap = new Map();

	constructor(root, isGit, trackedFiles, visibilityMap) {
		this.#root = root;
		this.#isGit = isGit;
		this.#trackedFiles = trackedFiles;
		this.#visibilityMap = visibilityMap;
	}

	/**
	 * Static factory to initialize a ProjectContext.
	 * visibilityOverrides: Map of path -> status from DB
	 */
	static async open(path, visibilityOverrides = new Map()) {
		const detectedRoot = await GitProvider.detectRoot(path);
		const root = detectedRoot || path;
		const isGit = detectedRoot !== null;

		let trackedFiles = new Set();
		if (isGit) {
			trackedFiles = await GitProvider.getTrackedFiles(root);
		}

		return new ProjectContext(root, isGit, trackedFiles, visibilityOverrides);
	}

	async resolveState(relPath) {
		// 1. Manual Overrides (Explicit DB State)
		const override = this.#visibilityMap.get(relPath);
		if (override) return override;

		// 2. Git Status (Only if in a git repo)
		if (this.#isGit) {
			if (this.#trackedFiles.has(relPath)) return FileState.MAPPABLE;
			if (await GitProvider.isIgnored(this.#root, relPath))
				return FileState.IGNORED;
			return FileState.INVISIBLE;
		}

		// 3. Restrictive Fallback: If not in Git and not explicitly added, it's ignored.
		return FileState.IGNORED;
	}

	get root() {
		return this.#root;
	}
	get isGit() {
		return this.#isGit;
	}

	async getMappableFiles() {
		const all = new Set();

		if (this.#isGit) {
			for (const f of this.#trackedFiles) all.add(f);
		}

		// Add everything explicitly marked in DB except ignored
		for (const [path, status] of this.#visibilityMap.entries()) {
			if (status === FileState.IGNORED) all.delete(path);
			else all.add(path);
		}

		return Array.from(all);
	}
}

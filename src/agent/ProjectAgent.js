import LlmProvider from "../llm/LlmProvider.js";
import AgentLoop from "./AgentLoop.js";
import KnownStore from "./KnownStore.js";
import TurnExecutor from "./TurnExecutor.js";

export default class ProjectAgent {
	#db;
	#hooks;
	#agentLoop;
	#knownStore;
	#llm;

	constructor(db, hooks) {
		this.#db = db;
		this.#hooks = hooks;
		this.#llm = new LlmProvider(db);
		this.#knownStore = new KnownStore(db);

		const turnExecutor = new TurnExecutor(
			db,
			this.#llm,
			hooks,
			this.#knownStore,
		);
		this.#agentLoop = new AgentLoop(
			db,
			this.#llm,
			hooks,
			turnExecutor,
			this.#knownStore,
		);
	}

	async init(projectName, projectRoot, configPath) {
		await this.#hooks.project.init.started.emit({
			projectName,
			projectRoot,
		});

		const projectRow = await this.#db.upsert_project.get({
			name: projectName,
			project_root: projectRoot,
			config_path: configPath || null,
		});
		const projectId = projectRow.id;

		const { default: GitProvider } = await import(
			"../plugins/file/GitProvider.js"
		);
		const gitRoot = await GitProvider.detectRoot(projectRoot);
		const headHash = gitRoot ? await GitProvider.getHeadHash(gitRoot) : null;

		const result = {
			projectId,
			context: { gitRoot, headHash },
		};

		await this.#hooks.project.init.completed.emit({
			...result,
			projectRoot,
			db: this.#db,
		});
		return result;
	}

	get entries() {
		return this.#knownStore;
	}

	// --- Run operations ---

	async ask(projectId, model, prompt, run = null, options = {}) {
		return this.#agentLoop.run(
			"ask",
			projectId,
			model,
			prompt,
			null,
			run,
			options,
		);
	}

	async act(projectId, model, prompt, run = null, options = {}) {
		return this.#agentLoop.run(
			"act",
			projectId,
			model,
			prompt,
			null,
			run,
			options,
		);
	}

	async resolve(run, resolution) {
		return this.#agentLoop.resolve(run, resolution);
	}

	async inject(run, message) {
		return this.#agentLoop.inject(run, message);
	}

	async getRunHistory(run) {
		return this.#agentLoop.getRunHistory(run);
	}

	abortRun(runId) {
		this.#agentLoop.abort(runId);
	}
}

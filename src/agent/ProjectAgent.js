import crypto from "node:crypto";
import OpenRouterClient from "../core/OpenRouterClient.js";
import ProjectContext from "../core/ProjectContext.js";
import RepoMap from "../core/RepoMap.js";

export default class ProjectAgent {
	#db;
	#client;

	constructor(db) {
		this.#db = db;
		this.#client = new OpenRouterClient(process.env.OPENROUTER_API_KEY);
	}

	async init(projectPath, projectName, clientId) {
		const projectId = crypto.randomUUID();
		const sessionId = crypto.randomUUID();

		// Use the prepared upsert_project method
		await this.#db.upsert_project.run({
			id: projectId,
			path: projectPath,
			name: projectName || projectPath.split("/").pop(),
		});

		// Use the prepared get_project_by_path method
		const projects = await this.#db.get_project_by_path.all({
			path: projectPath,
		});

		if (!projects || projects.length === 0) {
			throw new Error(`Failed to create/fetch project at ${projectPath}`);
		}

		const actualProjectId = projects[0].id;

		// Initialize RepoMap
		const ctx = await ProjectContext.open(projectPath);
		const repoMap = new RepoMap(ctx, this.#db, actualProjectId);
		await repoMap.updateIndex();

		// Use the prepared create_session method
		await this.#db.create_session.run({
			id: sessionId,
			project_id: actualProjectId,
			client_id: clientId,
		});

		return {
			projectId: actualProjectId,
			sessionId,
		};
	}

	async getFiles(projectPath) {
		const ctx = await ProjectContext.open(projectPath);
		const mappable = await ctx.getMappableFiles();
		const results = [];

		for (const relPath of mappable) {
			const state = await ctx.resolveState(relPath);
			results.push({
				path: relPath,
				state,
			});
		}

		return results;
	}

	async startJob(sessionId, jobConfig) {
		const jobId = crypto.randomUUID();

		// Use the prepared create_job method
		await this.#db.create_job.run({
			id: jobId,
			session_id: sessionId,
			parent_job_id: jobConfig.parentJobId || null,
			type: jobConfig.type || "orchestrator",
			config: JSON.stringify(jobConfig.config || {}),
		});

		return jobId;
	}

	async ask(sessionId, model, prompt, activeFiles = []) {
		const sessions = await this.#db.get_session_by_id.all({ id: sessionId });
		if (!sessions || sessions.length === 0)
			throw new Error("Session not found");
		const project = await this.#db.get_project_by_id.get({
			id: sessions[0].project_id,
		});

		const jobId = crypto.randomUUID();
		await this.#db.create_job.run({
			id: jobId,
			session_id: sessionId,
			type: "ask",
			config: JSON.stringify({ model, activeFiles }),
		});

		// 1. Get RepoMap Perspective
		const ctx = await ProjectContext.open(project.path);
		const repoMap = new RepoMap(ctx, this.#db, project.id);
		const perspective = await repoMap.renderPerspective(activeFiles);

		// 2. Build Messages
		const systemPrompt = `You are a helpful assistant. Here is the project map:\n\n${JSON.stringify(perspective, null, 2)}`;
		const messages = [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: prompt },
		];

		// 3. Persist Initial Turn (Request)
		await this.#db.create_turn.run({
			job_id: jobId,
			sequence_number: 0,
			payload: JSON.stringify(messages),
			usage: null,
		});

		// 4. Resolve Model (Handle Aliases)
		let targetModel = model;
		const envKey = `SNORE_MODEL_${model}`;
		const envAlias = process.env[envKey];

		if (envAlias) {
			targetModel = envAlias;
		}

		// 5. Call Model
		const result = await this.#client.completion(messages, targetModel);

		// 6. Persist Response Turn
		const responseMessage = result.choices?.[0]?.message;
		await this.#db.create_turn.run({
			job_id: jobId,
			sequence_number: 1,
			payload: JSON.stringify(responseMessage),
			usage: JSON.stringify(result.usage),
		});

		// 6. Complete Job
		await this.#db.update_job_status.run({ id: jobId, status: "completed" });

		return {
			jobId,
			response: responseMessage?.content,
		};
	}
}

import assert from "node:assert";
import fs from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it, mock } from "node:test";
import ProjectAgent from "./ProjectAgent.js";

describe("ProjectAgent Unit", () => {
	const projectPath = join(process.cwd(), "test_agent_unit");

	before(async () => {
		process.env.OPENROUTER_API_KEY = "test-key";
		await fs.mkdir(projectPath, { recursive: true }).catch(() => {});
	});

	after(async () => {
		await fs.rm(projectPath, { recursive: true, force: true }).catch(() => {});
	});

	it("should initialize a project correctly", async () => {
		const mockDb = {
			upsert_project: { run: mock.fn(async () => {}) },
			get_project_by_path: { all: mock.fn(async () => [{ id: "proj-1" }]) },
			create_session: { run: mock.fn(async () => {}) },
			get_repo_map_file: { get: mock.fn(async () => null) },
			upsert_repo_map_file: { get: mock.fn(async () => ({ id: "file-id" })) },
			clear_repo_map_file_data: { run: mock.fn(async () => {}) },
			insert_repo_map_tag: { run: mock.fn(async () => {}) },
			insert_repo_map_ref: { run: mock.fn(async () => {}) },
			get_project_repo_map: { all: mock.fn(async () => []) },
		};

		const agent = new ProjectAgent(mockDb);
		const result = await agent.init(projectPath, "Test", "client-1");

		assert.strictEqual(result.projectId, "proj-1");
		assert.ok(result.sessionId);
		assert.strictEqual(mockDb.upsert_project.run.mock.callCount(), 1);
	});

	it("should throw error if project creation fails", async () => {
		const mockDb = {
			upsert_project: { run: mock.fn() },
			get_project_by_path: { all: mock.fn(async () => []) },
		};
		const agent = new ProjectAgent(mockDb);
		await assert.rejects(
			agent.init(projectPath, "Test", "c1"),
			/Failed to create\/fetch project/,
		);
	});

	it("should get files and their states", async () => {
		const mockDb = {};
		const agent = new ProjectAgent(mockDb);
		const files = await agent.getFiles(projectPath);
		assert.ok(Array.isArray(files));
	});

	it("should handle 'ask' method", async () => {
		const mockDb = {
			get_session_by_id: { all: mock.fn(async () => [{ project_id: "p1" }]) },
			get_project_by_id: {
				get: mock.fn(async () => ({ id: "p1", path: projectPath })),
			},
			create_job: { run: mock.fn() },
			get_repo_map_file: { get: mock.fn(async () => null) },
			upsert_repo_map_file: { get: mock.fn(async () => ({ id: "f1" })) },
			clear_repo_map_file_data: { run: mock.fn() },
			insert_repo_map_tag: { run: mock.fn() },
			insert_repo_map_ref: { run: mock.fn() },
			get_project_repo_map: { all: mock.fn(async () => []) },
			get_file_references: { all: mock.fn(async () => []) },
			create_turn: { run: mock.fn() },
			update_job_status: { run: mock.fn() },
		};

		mock.method(globalThis, "fetch", async () => ({
			ok: true,
			json: async () => ({
				choices: [{ message: { content: "Paris" } }],
				usage: { total_tokens: 10 },
			}),
		}));

		const agent = new ProjectAgent(mockDb);
		const result = await agent.ask("sess-1", "gpt-4o", "Capital of France?");

		assert.strictEqual(result.response, "Paris");
		assert.strictEqual(mockDb.create_job.run.mock.callCount(), 1);
	});

	it("should throw if session not found in ask", async () => {
		const mockDb = {
			get_session_by_id: { all: mock.fn(async () => []) },
		};
		const agent = new ProjectAgent(mockDb);
		await assert.rejects(agent.ask("s1", "m1", "p1"), /Session not found/);
	});
});

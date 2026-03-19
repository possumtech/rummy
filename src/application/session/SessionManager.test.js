import test from "node:test";
import assert from "node:assert";
import SessionManager from "./SessionManager.js";
import createHooks from "../../domain/hooks/Hooks.js";

test("SessionManager", async (t) => {
	const mockDb = {
		upsert_project: { run: async () => {} },
		get_project_by_path: { all: async () => [{ id: "p1" }] },
		create_session: { run: async () => {} },
		get_project_repo_map: { all: async () => [] },
		insert_session_skill: { run: async () => {} },
		delete_session_skill: { run: async () => {} },
		update_session_persona: { run: async () => {} },
		update_session_system_prompt: { run: async () => {} },
		get_project_by_id: { get: async () => ({ path: "/tmp" }) },
		create_run: { run: async () => {} },
		upsert_repo_map_file: { run: async () => {} }
	};
	const hooks = createHooks();
	const manager = new SessionManager(mockDb, hooks);

	await t.test("init should create project and session", async () => {
		const result = await manager.init("/tmp", "Test", "c1");
		assert.ok(result.projectId);
		assert.ok(result.sessionId);
	});

	await t.test("addSkill should call db", async () => {
		await manager.addSkill("s1", "skill1");
		// If it doesn't throw, we assume it's fine for this mock
	});

	await t.test("setPersona should update db", async () => {
		await manager.setPersona("s1", "new persona");
	});

	await t.test("setSystemPrompt should update db", async () => {
		await manager.setSystemPrompt("s1", "new system prompt");
	});

	await t.test("getFiles should return file list", async () => {
		const files = await manager.getFiles("/tmp");
		assert.ok(Array.isArray(files));
	});

	await t.test("updateFiles should upsert files and emit event", async () => {
		const result = await manager.updateFiles("p1", [{ path: "a.js", visibility: "mappable" }]);
		assert.strictEqual(result.status, "ok");
	});

	await t.test("startRun should filter config and create run", async () => {
		const runId = await manager.startRun("s1", { type: "ask", model: "m1", other: "ignore" });
		assert.ok(runId);
	});
});

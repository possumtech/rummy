import test from "node:test";
import assert from "node:assert";
import AgentLoop from "./AgentLoop.js";
import createHooks from "../../domain/hooks/Hooks.js";

test("AgentLoop", async (t) => {
	const hooks = createHooks();
	const mockDb = {
		get_session_by_id: { all: async () => [{ project_id: "p1" }] },
		get_project_by_id: { get: async () => ({ path: "/tmp" }) },
		create_run: { run: async () => {} },
		create_turn: { get: async () => ({ id: 1 }) },
		update_run_status: { run: async () => {} },
		get_turns_by_run_id: { all: async () => [] },
		get_findings_by_run_id: { all: async () => [] },
	};
	const mockLlm = {
		completion: async () => ({
			choices: [{ message: { role: "assistant", content: "<tasks>- [x] done</tasks><response>Hi</response>" } }],
			usage: { total_tokens: 10 }
		})
	};
	const mockTurnBuilder = {
		build: async () => ({
			toJson: () => ({ assistant: { content: "Hi" } }),
			serialize: async () => [{ role: "user", content: "test" }, { role: "system", content: "sys" }],
			assistant: { reasoning: { add: () => {} }, content: { add: () => {} }, meta: { add: () => {} } }
		})
	};
	const mockParser = {
		parseActionTags: () => [{ tagName: "response" }, { tagName: "tasks" }],
		getNodeText: () => "Task list",
		mergePrefill: (p, c) => p + c
	};
	const mockFindings = {
		populateFindings: async () => {},
		resolveOutstandingFindings: async () => ({ remainingCount: 0, proposed: [] })
	};

	const loop = new AgentLoop(mockDb, mockLlm, hooks, mockTurnBuilder, mockParser, mockFindings);

	await t.test("run should complete a simple turn", async () => {
		const result = await loop.run("ask", "s1", "m1", "hello");
		assert.strictEqual(result.status, "completed");
	});

	await t.test("run should resume with history", async () => {
		const runId = "r1";
		mockDb.get_run_by_id = { get: async () => ({ id: runId, session_id: "s1", config: "{}" }) };
		mockDb.get_turns_by_run_id.all = async () => [
			{ sequence_number: 0, payload: JSON.stringify([{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }]) }
		];
		
		const result = await loop.run("ask", "s1", "m1", "next", [], runId);
		assert.strictEqual(result.status, "completed");
	});

	await t.test("run should block if findings are pending", async () => {
		const runId = "r2";
		mockDb.get_run_by_id = { get: async () => ({ id: runId, session_id: "s1", config: "{}" }) };
		mockFindings.resolveOutstandingFindings = async () => ({ remainingCount: 1, proposed: [{ id: 1, status: "proposed" }] });
		
		const result = await loop.run("ask", "s1", "m1", "next", [], runId);
		assert.strictEqual(result.status, "proposed");
	});

	await t.test("run should terminate on checklist completion", async () => {
		mockParser.parseActionTags = (content) => [
			{ tagName: "tasks", isMock: true, childNodes: [{ value: "- [x] all done" }] },
			{ tagName: "response", isMock: true, childNodes: [{ value: "bye" }] }
		];
		mockParser.getNodeText = () => "- [x] all done";
		
		const result = await loop.run("ask", "s1", "m1", "finish");
		assert.strictEqual(result.status, "completed");
	});

	await t.test("run should handle stall protection", async () => {
		mockParser.parseActionTags = () => [
			{ tagName: "unknown", isMock: true, childNodes: [{ value: "none" }] }
		];
		mockParser.getNodeText = () => "none";
		
		const result = await loop.run("ask", "s1", "m1", "stall");
		assert.strictEqual(result.status, "completed");
	});

	await t.test("run should handle yolo mode", async () => {
		const runId = "r_yolo";
		mockDb.get_run_by_id = { get: async () => ({ id: runId, session_id: "s1", config: JSON.stringify({ yolo: true }) }) };
		mockDb.get_findings_by_run_id = { all: async () => [{ id: 1, status: "proposed", category: "command", patch: "ls" }] };
		mockDb.update_finding_command_status = { run: async () => {} };
		
		const result = await loop.run("ask", "s1", "m1", "yolo", [], runId);
		assert.strictEqual(result.status, "completed");
	});

	await t.test("run should handle information gathering", async () => {
		mockLlm.completion = async () => ({
			choices: [{ message: { role: "assistant", content: "<read file=\"a.js\"/><run>ls</run>" } }],
			usage: { total_tokens: 10 }
		});
		// Second turn will complete
		let callCount = 0;
		const originalCompletion = mockLlm.completion;
		mockLlm.completion = async () => {
			callCount++;
			if (callCount === 1) return {
				choices: [{ message: { role: "assistant", content: "<read file=\"a.js\"/><run>ls</run>" } }],
				usage: { total_tokens: 10 }
			};
			return {
				choices: [{ message: { role: "assistant", content: "<response>Done</response>" } }],
				usage: { total_tokens: 5 }
			};
		};
		
		mockParser.parseActionTags = (content) => {
			if (content.includes("read")) return [{ tagName: "read", attrs: [{ name: "file", value: "a.js" }] }, { tagName: "run", isMock: true, childNodes: [{ value: "ls" }] }];
			return [{ tagName: "response" }];
		};

		const result = await loop.run("ask", "s1", "m1", "gather");
		assert.strictEqual(result.status, "completed");
		mockLlm.completion = originalCompletion;
	});

	await t.test("run should stop on breaking changes", async () => {
		mockLlm.completion = async () => ({
			choices: [{ message: { role: "assistant", content: "<create file=\"b.js\">content</create>" } }],
			usage: { total_tokens: 10 }
		});
		mockParser.parseActionTags = () => [{ tagName: "create", attrs: [{ name: "file", value: "b.js" }] }];
		mockDb.insert_finding_diff = { run: async () => {} };
		mockDb.insert_finding_command = { run: async () => {} };
		mockDb.insert_finding_notification = { run: async () => {} };

		const result = await loop.run("ask", "s1", "m1", "breaking");
		assert.strictEqual(result.status, "proposed");
	});
});

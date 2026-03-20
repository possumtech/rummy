import test from "node:test";
import assert from "node:assert";
import { mock } from "node:test";
import TurnBuilder from "./TurnBuilder.js";
import PromptManager from "../prompt/PromptManager.js";

test("TurnBuilder class", async (t) => {
	const createMockDb = () => ({
		get_session_by_id: {
			all: mock.fn(async () => [{ system_prompt: "Custom prompt", persona: "Helper" }]),
		},
		get_session_skills: {
			all: mock.fn(async () => [{ name: "git" }]),
		},
		get_protocol_constraints: {
			get: mock.fn(async () => ({ required_tags: "tasks known unknown", allowed_tags: "tasks known unknown read env" })),
		},
	});

	const mockHooks = {
		processTurn: mock.fn(async () => {}),
	};

	await t.test("build() creates a Turn with expected structure", async () => {
		const getSystemPromptMock = mock.method(PromptManager, "getSystemPrompt", async () => "Base system prompt");
		const builder = new TurnBuilder(mockHooks);
		const turn = await builder.build({
			prompt: "Hello",
			sessionId: "session-1",
			db: createMockDb(),
			type: "ask",
			sequence: 5,
		});

		assert.ok(turn);
		assert.strictEqual(turn.doc.documentElement.getAttribute("sequence"), "5");
		
		const systemEl = turn.doc.getElementsByTagName("system")[0];
		assert.ok(systemEl.textContent.includes("Base system prompt"));

		const userEl = turn.doc.getElementsByTagName("user")[0];
		assert.ok(userEl.textContent.includes("Hello"));
		
		const personaEl = turn.doc.getElementsByTagName("persona")[0];
		assert.strictEqual(personaEl.textContent, "Helper");

		const skillEl = turn.doc.getElementsByTagName("skill")[0];
		assert.strictEqual(skillEl.textContent, "git");

		assert.strictEqual(mockHooks.processTurn.mock.calls.length, 1);
		getSystemPromptMock.mock.restore();
	});

    await t.test("build() act mode", async () => {
		const getSystemPromptMock = mock.method(PromptManager, "getSystemPrompt", async () => "Base system prompt");
		const builder = new TurnBuilder(mockHooks);
		const mockDb = createMockDb();
		mockDb.get_protocol_constraints.get = mock.fn(async () => ({ 
			required_tags: "tasks known unknown", 
			allowed_tags: "tasks known unknown read env edit create delete run analysis summary" 
		}));

        const turn = await builder.build({
            prompt: "Hi",
            type: "act",
            hasUnknowns: false, // This allows edit/create/etc.
			db: mockDb,
        });
        assert.ok(turn);
        const actEl = turn.doc.getElementsByTagName("act")[0];
        assert.ok(actEl);
        assert.ok(actEl.getAttribute("allowed_tags").includes("edit"));
		getSystemPromptMock.mock.restore();
    });
});

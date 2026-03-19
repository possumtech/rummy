import { strictEqual, ok } from "node:assert";
import { describe, it, mock } from "node:test";
import TurnBuilder from "./TurnBuilder.js";
import PromptManager from "../prompt/PromptManager.js";

describe("TurnBuilder", () => {
	it("should build a structured Turn with initial data", async () => {
		const hooks = {
			processTurn: async () => {},
		};
		const builder = new TurnBuilder(hooks);
		
		const getSystemPromptMock = mock.method(PromptManager, "getSystemPrompt", async () => "System Prompt");

		const initialData = {
			prompt: "User Prompt",
			type: "act",
			sequence: 1,
			sessionId: "session-1",
			db: {
				get_session_by_id: { all: async () => [{ id: "session-1", system_prompt: "Custom" }] },
				get_session_skills: { all: async () => [] },
			},
		};

		const turn = await builder.build(initialData);

		const json = turn.toJson();
		strictEqual(json.sequence, 1);
		strictEqual(json.system, "System Prompt\n");
		strictEqual(json.user, "User Prompt");

		getSystemPromptMock.mock.restore();
	});

	it("should apply allowed and required tags based on context", async () => {
		const hooks = {
			processTurn: async () => {},
		};
		const builder = new TurnBuilder(hooks);
		mock.method(PromptManager, "getSystemPrompt", async () => "System Prompt");

		const turn = await builder.build({
			prompt: "User Prompt",
			type: "act",
			hasUnknowns: false, // Should allow edit, create etc.
		});

		const xml = turn.toXml();
		ok(xml.includes("allowed_tags=\"tasks known unknown read env edit create delete run analysis summary\""));
	});
});

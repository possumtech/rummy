import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import createHooks from "../hooks/Hooks.js";
import { registerPlugins } from "../plugins/index.js";
import ContextAssembler from "./ContextAssembler.js";

let hooks;

before(async () => {
	hooks = createHooks();
	const pluginsDir = join(
		dirname(fileURLToPath(import.meta.url)),
		"../plugins",
	);
	await registerPlugins([pluginsDir], hooks);
});

describe("ContextAssembler", () => {
	describe("assembleFromTurnContext", () => {
		it("renders system prompt; known + visible bodies in system", async () => {
			const rows = [
				{
					ordinal: 1,
					path: "known://auth",
					scheme: "known",
					visibility: "visible",
					body: "JWT",
					tokens: 1,
					attributes: null,
					category: "data",
					source_turn: 1,
				},
				{
					ordinal: 2,
					path: "src/app.js",
					scheme: null,
					visibility: "visible",
					body: "const x = 1;",
					tokens: 5,
					attributes: null,
					category: "data",
					source_turn: 1,
				},
				{
					ordinal: 3,
					path: "prompt://1",
					scheme: "prompt",
					visibility: "visible",
					body: "What does this do?",
					tokens: 3,
					attributes: JSON.stringify({ mode: "ask" }),
					category: "prompt",
					source_turn: 1,
				},
			];
			const messages = await ContextAssembler.assembleFromTurnContext(
				rows,
				{ systemPrompt: "You are helpful." },
				hooks,
			);

			assert.strictEqual(messages.length, 2);
			assert.strictEqual(messages[0].role, "system");
			assert.ok(
				messages[0].content.startsWith("You are helpful."),
				"assembly.system chain seeds with the supplied systemPrompt",
			);
			assert.ok(
				messages[0].content.includes("Folksonomic XML Command Definitions"),
				"instructions plugin contributes the header at priority 50",
			);
			assert.strictEqual(messages[1].role, "user");
			const system = messages[0].content;
			const user = messages[1].content;
			assert.ok(system.includes("<summary>"), "system has <summary>");
			assert.ok(system.includes("<visible>"), "system has <visible>");
			assert.ok(system.includes("known://auth"), "known summary in system");
			assert.ok(system.includes("const x = 1;"), "file body in <visible>");
			assert.ok(user.includes("<prompt"), "user has <prompt>");
			assert.ok(user.includes("What does this do?"));
			assert.ok(
				system.indexOf("<summary>") < system.indexOf("<visible>"),
				"<summary> renders above <visible> in system",
			);
		});

		it("user message sandwich: persona → prompt → budget → instructions", async () => {
			const rows = [
				{
					ordinal: 1,
					path: "prompt://1",
					scheme: "prompt",
					visibility: "visible",
					body: "The question",
					tokens: 3,
					attributes: JSON.stringify({ mode: "ask" }),
					category: "prompt",
					source_turn: 1,
				},
			];
			const messages = await ContextAssembler.assembleFromTurnContext(
				rows,
				{
					systemPrompt: "sys",
					contextSize: 32768,
					persona: "You are a careful auditor.",
				},
				hooks,
			);

			const user = messages[1].content;
			const personaPos = user.indexOf("Operational Persona");
			const promptPos = user.indexOf("<prompt");
			const budgetPos = user.indexOf("<budget");
			const instructionsPos = user.indexOf("<instructions>");
			assert.ok(personaPos >= 0, "persona present at user-top");
			assert.ok(promptPos > personaPos, "prompt after persona");
			assert.ok(budgetPos > promptPos, "budget after prompt");
			assert.ok(
				instructionsPos > budgetPos,
				"instructions at action site (last in user) — recency for protocol discipline",
			);
		});

		it("unifies all logging entries across loops into a single <log> block", async () => {
			const rows = [
				{
					ordinal: 1,
					path: "log://turn_1/get/old.js",
					scheme: "log",
					visibility: "visible",
					state: "resolved",
					body: "old result",
					tokens: 5,
					attributes: JSON.stringify({ path: "old.js" }),
					category: "logging",
					source_turn: 1,
				},
				{
					ordinal: 2,
					path: "prompt://3",
					scheme: "prompt",
					visibility: "visible",
					body: "New question",
					tokens: 3,
					attributes: JSON.stringify({ mode: "ask" }),
					category: "prompt",
					source_turn: 3,
				},
				{
					ordinal: 3,
					path: "log://turn_3/get/new.js",
					scheme: "log",
					visibility: "visible",
					state: "resolved",
					body: "new result",
					tokens: 5,
					attributes: JSON.stringify({ path: "new.js" }),
					category: "logging",
					source_turn: 3,
				},
			];
			const messages = await ContextAssembler.assembleFromTurnContext(
				rows,
				{ systemPrompt: "sys" },
				hooks,
			);

			const system = messages[0].content;
			assert.ok(!system.includes("<previous>"), "no <previous> block");
			assert.ok(system.includes("<log>"), "log is in system");
			assert.ok(system.includes("old.js"), "old get in log");
			assert.ok(system.includes("new.js"), "new get in log");
		});

		it("renders results with status symbols in log", async () => {
			const rows = [
				{
					ordinal: 1,
					path: "prompt://1",
					scheme: "prompt",
					visibility: "visible",
					body: "Fix it",
					tokens: 2,
					attributes: JSON.stringify({ mode: "act" }),
					category: "prompt",
					source_turn: 1,
				},
				{
					ordinal: 2,
					path: "log://turn_1/set/app.js",
					scheme: "log",
					visibility: "visible",
					state: "resolved",
					body: "",
					tokens: 0,
					attributes: JSON.stringify({ path: "app.js" }),
					category: "logging",
					source_turn: 1,
				},
				{
					ordinal: 3,
					path: "log://turn_1/update/done",
					scheme: "log",
					visibility: "visible",
					state: "resolved",
					body: "Fixed it",
					tokens: 2,
					attributes: null,
					category: "logging",
					source_turn: 1,
				},
			];
			const messages = await ContextAssembler.assembleFromTurnContext(
				rows,
				{ systemPrompt: "sys" },
				hooks,
			);
			const system = messages[0].content;

			assert.ok(system.includes('status="200"'), "pass result has status");
			assert.ok(system.includes("Fixed it"), "summary renders");
			assert.ok(system.includes("<log>"), "results in log block");
			assert.ok(
				system.includes("<set path="),
				"tool tags in log use tool name",
			);
		});

		it("renders empty context when no entries", async () => {
			const rows = [];
			const messages = await ContextAssembler.assembleFromTurnContext(
				rows,
				{ systemPrompt: "sys" },
				hooks,
			);

			assert.strictEqual(messages.length, 2);
			assert.ok(
				messages[0].content.startsWith("sys"),
				"assembly.system seeds with supplied systemPrompt",
			);
			assert.strictEqual(messages[1].role, "user");
			assert.ok(messages[1].content.includes("<prompt"));
		});

		it("renders the persona block at the top of the user message when ctx.persona is set", async () => {
			const messages = await ContextAssembler.assembleFromTurnContext(
				[],
				{ systemPrompt: "", persona: "You are a careful auditor." },
				hooks,
			);
			assert.ok(
				messages[1].content.includes("## Operational Persona"),
				"persona block in user message",
			);
			assert.ok(
				messages[1].content.includes("You are a careful auditor."),
				"persona body rendered in user message",
			);
			assert.ok(
				!messages[0].content.includes("## Operational Persona"),
				"persona is not in system any more",
			);
		});

		it("omits the persona block when ctx.persona is empty", async () => {
			const messages = await ContextAssembler.assembleFromTurnContext(
				[],
				{ systemPrompt: "" },
				hooks,
			);
			assert.ok(
				!messages[1].content.includes("## Operational Persona"),
				"no persona block when ctx.persona is unset",
			);
		});

		it("renders data entries in row order in system message", async () => {
			const rows = [
				{
					ordinal: 1,
					path: "src/app.js",
					scheme: null,
					visibility: "visible",
					body: "const x = 1;",
					tokens: 5,
					attributes: null,
					category: "data",
					source_turn: 3,
				},
				{
					ordinal: 2,
					path: "src/old.js",
					scheme: null,
					visibility: "visible",
					body: "const y = 2;",
					tokens: 5,
					attributes: null,
					category: "data",
					source_turn: 1,
				},
				{
					ordinal: 3,
					path: "known://auth",
					scheme: "known",
					visibility: "visible",
					body: "JWT",
					tokens: 1,
					attributes: null,
					category: "data",
					source_turn: 2,
				},
			];
			const messages = await ContextAssembler.assembleFromTurnContext(
				rows,
				{ systemPrompt: "sys" },
				hooks,
			);
			const system = messages[0].content;

			assert.ok(system.includes("<<:::known://auth"), "known fence in system");
			assert.ok(system.includes("const y = 2;"), "old file body in <visible>");
			assert.ok(system.includes("JWT"), "known body in <visible>");
			assert.ok(system.includes("const x = 1;"), "new file body in <visible>");
		});

		it("renders unknowns in their own <unknowns> block in the system message", async () => {
			const rows = [
				{
					ordinal: 1,
					path: "unknown://config",
					scheme: "unknown",
					visibility: "visible",
					body: "which database adapter",
					tokens: 3,
					attributes: null,
					category: "unknown",
					source_turn: 1,
				},
				{
					ordinal: 2,
					path: "prompt://1",
					scheme: "prompt",
					visibility: "visible",
					body: "Do it",
					tokens: 2,
					attributes: JSON.stringify({ mode: "act" }),
					category: "prompt",
					source_turn: 1,
				},
			];
			const messages = await ContextAssembler.assembleFromTurnContext(
				rows,
				{ systemPrompt: "sys" },
				hooks,
			);
			const user = messages[1].content;
			const system = messages[0].content;

			assert.ok(system.includes("<unknowns>"), "unknowns block rendered");
			assert.ok(
				system.includes("<<:::unknown://config"),
				"unknown fenced inside its own block",
			);
			assert.ok(system.includes("which database adapter"));
			assert.ok(
				!system.includes("<summary>") ||
					system.indexOf("<unknowns>") > system.indexOf("<summary>"),
				"unknowns block does not nest inside <summary>",
			);
			assert.ok(!user.includes("<unknowns>"), "no <unknowns> in user");
			assert.ok(!user.includes("<<:::unknown://"), "no unknowns in user");
		});

		it("prompt element carries tokenUsage and tokensFree attrs", async () => {
			const rows = [
				{
					ordinal: 1,
					path: "prompt://1",
					scheme: "prompt",
					visibility: "visible",
					body: "Build it",
					tokens: 2,
					attributes: JSON.stringify({ mode: "act" }),
					category: "prompt",
					source_turn: 1,
				},
			];
			const messages = await ContextAssembler.assembleFromTurnContext(
				rows,
				{ systemPrompt: "sys", contextSize: 32768 },
				hooks,
			);
			const user = messages[1].content;

			assert.ok(
				/tokenUsage="\d+"/.test(user),
				"prompt element carries tokenUsage",
			);
			assert.ok(
				/tokensFree="\d+"/.test(user),
				"prompt element carries tokensFree",
			);
		});

		it("summary projection renders as the tag body inside <summary>", async () => {
			const rows = [
				{
					ordinal: 1,
					path: "src/agent/AgentLoop.js",
					scheme: null,
					visibility: "summarized",
					body: "class AgentLoop { #foo; async start(); }",
					sBody: "class AgentLoop { #foo; async start(); }",
					vBody: "class AgentLoop { #foo; async start() { /* full body */ } }",
					tokens: 12,
					attributes: null,
					category: "data",
					source_turn: 1,
				},
				{
					ordinal: 2,
					path: "prompt://1",
					scheme: "prompt",
					visibility: "visible",
					body: "Refactor",
					tokens: 1,
					attributes: JSON.stringify({ mode: "ask" }),
					category: "prompt",
					source_turn: 1,
				},
			];
			const messages = await ContextAssembler.assembleFromTurnContext(
				rows,
				{ systemPrompt: "sys" },
				hooks,
			);
			const system = messages[0].content;
			const summarizedBlock = system.match(
				/<summary>([\s\S]*?)<\/summary>/,
			)?.[1];
			assert.ok(summarizedBlock, "<summary> block exists in system");
			assert.ok(
				summarizedBlock.includes("class AgentLoop"),
				"summary projection renders inside heredoc — symbols visible to model",
			);
			assert.ok(
				summarizedBlock.includes("<<:::src/agent/AgentLoop.js"),
				"entry uses heredoc fence with path-as-marker",
			);
		});

		it("visible block renders the full visible projection, summarized block renders the summarized projection", async () => {
			const rows = [
				{
					ordinal: 1,
					path: "known://fact",
					scheme: "known",
					visibility: "visible",
					body: "FULL BODY HERE",
					sBody: "short summary",
					vBody: "FULL BODY HERE",
					attributes: null,
					category: "data",
					source_turn: 2,
				},
				{
					ordinal: 2,
					path: "prompt://1",
					scheme: "prompt",
					visibility: "visible",
					body: "ask",
					attributes: JSON.stringify({ mode: "ask" }),
					category: "prompt",
					source_turn: 2,
				},
			];
			const messages = await ContextAssembler.assembleFromTurnContext(
				rows,
				{ systemPrompt: "sys" },
				hooks,
			);
			const system = messages[0].content;
			const summarizedBlock = system.match(
				/<summary>([\s\S]*?)<\/summary>/,
			)?.[1];
			const visibleBlock = system.match(/<visible>([\s\S]*?)<\/visible>/)?.[1];
			assert.ok(summarizedBlock.includes("short summary"));
			assert.ok(!summarizedBlock.includes("FULL BODY HERE"));
			assert.ok(visibleBlock.includes("FULL BODY HERE"));
			assert.ok(!visibleBlock.includes("short summary"));
		});
	});
});

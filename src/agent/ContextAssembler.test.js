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

function dataRow({
	path,
	scheme,
	body,
	tokens = 0,
	attributes = null,
	turn = 1,
}) {
	return {
		ordinal: 1,
		path,
		scheme,
		visibility: "indexed",
		state: "resolved",
		body,
		vBody: body,
		vTokens: tokens,
		aTokens: tokens,
		vLines: 0,
		attributes,
		category: "data",
		source_turn: turn,
	};
}

function logRow({
	path,
	body = "",
	tokens = 0,
	attributes = null,
	turn = 1,
	state = "resolved",
}) {
	return {
		ordinal: 1,
		path,
		scheme: "log",
		visibility: "indexed",
		state,
		outcome: null,
		body,
		vBody: body,
		vTokens: tokens,
		aTokens: tokens,
		vLines: 0,
		attributes:
			typeof attributes === "object" && attributes !== null
				? JSON.stringify(attributes)
				: attributes,
		category: "logging",
		source_turn: turn,
	};
}

describe("ContextAssembler", () => {
	describe("assembleFromTurnContext", () => {
		it("system carries <system_commands> + <index>; user carries <log> + <turn>", async () => {
			const rows = [
				dataRow({
					path: "known://auth",
					scheme: "known",
					body: "JWT",
					tokens: 1,
				}),
				dataRow({
					path: "src/app.js",
					scheme: null,
					body: "const x = 1;",
					tokens: 5,
				}),
				logRow({
					path: "log://turn_1/prompt/1",
					body: "What does this do?",
					tokens: 4,
					attributes: { path: "prompt://1", mode: "ask" },
				}),
			];
			const messages = await ContextAssembler.assembleFromTurnContext(
				rows,
				{ systemPrompt: "You are helpful.", contextSize: 32768 },
				hooks,
			);

			assert.strictEqual(messages.length, 2);
			assert.strictEqual(messages[0].role, "system");
			assert.strictEqual(messages[1].role, "user");
			const system = messages[0].content;
			const user = messages[1].content;
			assert.ok(system.startsWith("You are helpful."));
			assert.ok(system.includes("Folksonomic XML Command Definitions"));
			assert.ok(system.includes("<index>"), "system has <index>");
			assert.ok(system.includes("known://auth"), "known tile in index");
			assert.ok(user.includes("<log>"), "log lives in user");
			assert.ok(user.includes("What does this do?"), "prompt body in log");
			assert.ok(user.includes("<turn"), "turn meta in user");
			// system_commands tooldocs may mention <log>/<index>; check for
			// the rendered section opening (newline-anchored) instead.
			assert.doesNotMatch(user, /^<index>/m, "<index> stays in system");
			assert.doesNotMatch(system, /^<log>/m, "<log> stays in user");
		});

		it("user message order: persona → log → turn → system_requirements", async () => {
			const messages = await ContextAssembler.assembleFromTurnContext(
				[
					logRow({
						path: "log://turn_1/prompt/1",
						body: "ask",
						tokens: 1,
						attributes: { path: "prompt://1", mode: "act" },
					}),
				],
				{
					systemPrompt: "sys",
					contextSize: 32768,
					persona: "You are a careful auditor.",
				},
				hooks,
			);
			const user = messages[1].content;
			const personaPos = user.indexOf("<system_instructions>");
			const logPos = user.indexOf("<log>");
			const turnPos = user.indexOf("<turn");
			const reqPos = user.indexOf("<system_requirements>");
			assert.ok(personaPos >= 0, "<system_instructions> present");
			assert.ok(logPos > personaPos, "<log> after persona");
			assert.ok(turnPos > logPos, "<turn> after <log>");
			assert.ok(
				reqPos > turnPos,
				"<system_requirements> last (recency for protocol discipline)",
			);
		});

		it("logging entries from prior loops appear in the <log> block", async () => {
			const rows = [
				logRow({
					path: "log://turn_1/get/old.js",
					body: "old result",
					tokens: 5,
					attributes: { path: "old.js" },
					turn: 1,
				}),
				logRow({
					path: "log://turn_3/prompt/3",
					body: "new question",
					tokens: 4,
					attributes: { path: "prompt://3", mode: "ask" },
					turn: 3,
				}),
				logRow({
					path: "log://turn_3/get/new.js",
					body: "new result",
					tokens: 5,
					attributes: { path: "new.js" },
					turn: 3,
				}),
			];
			const messages = await ContextAssembler.assembleFromTurnContext(
				rows,
				{ systemPrompt: "sys", contextSize: 32768 },
				hooks,
			);
			const user = messages[1].content;
			assert.ok(user.includes("<log>"));
			assert.ok(user.includes("old.js"));
			assert.ok(user.includes("new.js"));
			assert.ok(user.includes("new question"));
		});

		it("renders empty user content with no rows", async () => {
			const messages = await ContextAssembler.assembleFromTurnContext(
				[],
				{ systemPrompt: "sys", contextSize: 32768 },
				hooks,
			);
			assert.strictEqual(messages.length, 2);
			assert.ok(messages[0].content.startsWith("sys"));
			assert.strictEqual(messages[1].role, "user");
			// User has the <turn> tag (always rendered when contextSize > 0)
			assert.ok(messages[1].content.includes("<turn"));
		});

		it("<system_instructions> at top of user when ctx.persona is set", async () => {
			const messages = await ContextAssembler.assembleFromTurnContext(
				[],
				{
					systemPrompt: "",
					contextSize: 32768,
					persona: "You are a careful auditor.",
				},
				hooks,
			);
			assert.ok(messages[1].content.includes("<system_instructions>"));
			assert.ok(messages[1].content.includes("You are a careful auditor."));
			assert.ok(!messages[0].content.includes("<system_instructions>"));
		});

		it("omits <system_instructions> when ctx.persona is empty", async () => {
			const messages = await ContextAssembler.assembleFromTurnContext(
				[],
				{ systemPrompt: "", contextSize: 32768 },
				hooks,
			);
			assert.ok(!messages[1].content.includes("<system_instructions>"));
		});

		it("data entries (knowns + files + unknowns) all land in <index>", async () => {
			const rows = [
				dataRow({
					path: "src/app.js",
					scheme: null,
					body: "const x = 1;",
					tokens: 5,
				}),
				dataRow({
					path: "known://auth",
					scheme: "known",
					body: "JWT",
					tokens: 1,
				}),
				dataRow({
					path: "unknown://config",
					scheme: "unknown",
					body: "which database adapter",
					tokens: 3,
				}),
			];
			const messages = await ContextAssembler.assembleFromTurnContext(
				rows,
				{ systemPrompt: "sys", contextSize: 32768 },
				hooks,
			);
			const system = messages[0].content;
			const indexBlock = system.match(/<index>([\s\S]*?)<\/index>/)?.[1];
			assert.ok(indexBlock);
			assert.match(indexBlock, /<<:::known:\/\/auth/);
			assert.match(indexBlock, /<<:::unknown:\/\/config/);
			assert.match(indexBlock, /<<:::src\/app\.js/);
			assert.ok(!system.includes("<unknowns>"), "no <unknowns> section");
		});

		it("<turn> carries tokenUsage and tokensFree attrs", async () => {
			const messages = await ContextAssembler.assembleFromTurnContext(
				[],
				{ systemPrompt: "sys", contextSize: 32768 },
				hooks,
			);
			const user = messages[1].content;
			assert.match(user, /<turn[^>]*tokenUsage="\d+"/);
			assert.match(user, /<turn[^>]*tokensFree="\d+"/);
		});

		it("catalog projection renders as the tag body inside <index>", async () => {
			const rows = [
				dataRow({
					path: "known://plan",
					scheme: "known",
					body: "step 1\nstep 2",
					tokens: 4,
				}),
			];
			const messages = await ContextAssembler.assembleFromTurnContext(
				rows,
				{ systemPrompt: "sys", contextSize: 32768 },
				hooks,
			);
			const system = messages[0].content;
			const indexBlock = system.match(/<index>([\s\S]*?)<\/index>/)?.[1];
			assert.ok(indexBlock);
			assert.match(indexBlock, /step 1/);
			assert.match(indexBlock, /<<:::known:\/\/plan/);
		});
	});
});

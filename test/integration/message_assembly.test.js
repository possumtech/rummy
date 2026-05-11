/**
 * Message assembly integration test.
 *
 * Covers @packet_structure, @message_structure,
 * @loops_previous_performed, @instructions_plugin, @log_plugin,
 * @plugins_filter_bands — what we actually send to the model.
 * Populates known_entries, materializes turn_context, assembles the
 * messages, and inspects system and user content directly including
 * the rendering of prior-loop and current-loop entries. Filter
 * priority bands (@plugins_filter_bands) govern packet structure:
 * grammar + tooldocs are wrapped in `<system_commands>` (49–101);
 * `<index>`/`<log>`/`<unknowns>` are system-side
 * (priorities 200/300/350). User-side: persona at
 * `<system_instructions>` (10), `<prompt>` (30), `<budget>` (90),
 * per-turn rules at `<system_requirements>` (165).
 */
import assert from "node:assert";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import ContextAssembler from "../../src/agent/ContextAssembler.js";
import Entries from "../../src/agent/Entries.js";
import createHooks from "../../src/hooks/Hooks.js";
import { registerPlugins } from "../../src/plugins/index.js";
import materialize from "../helpers/materialize.js";
import TestDb from "../helpers/TestDb.js";

let RUN_ID;
let hooks;
const TURN = 1;

async function assembleMessages(tdb, _store) {
	await materialize(tdb.db, {
		runId: RUN_ID,
		turn: TURN,
		systemPrompt: "You are a test assistant.",
	});
	const rows = await tdb.db.get_turn_context.all({
		run_id: RUN_ID,
		turn: TURN,
	});
	return ContextAssembler.assembleFromTurnContext(
		rows,
		{
			type: "ask",
			contextSize: 32768,
			toolSet: hooks.tools.resolveForLoop("ask"),
		},
		hooks,
	);
}

describe("Message assembly", () => {
	let tdb, store;

	before(async () => {
		hooks = createHooks();
		const pluginsDir = join(
			dirname(fileURLToPath(import.meta.url)),
			"../../src/plugins",
		);
		await registerPlugins([pluginsDir], hooks);
		tdb = await TestDb.create();
		store = new Entries(tdb.db);
		const seed = await tdb.seedRun();
		RUN_ID = seed.runId;
	});

	after(async () => {
		await tdb.cleanup();
	});

	it("ask mode: <turn> surfaces warn attr; sh excluded from commands", async () => {
		// Warn lives on <turn> per S11 (not <prompt>).
		await materialize(tdb.db, {
			runId: RUN_ID,
			turn: TURN,
			systemPrompt: "You are a test assistant.",
		});
		const rows = await tdb.db.get_turn_context.all({
			run_id: RUN_ID,
			turn: TURN,
		});
		const messages = await ContextAssembler.assembleFromTurnContext(
			rows,
			{
				type: "ask",
				toolSet: hooks.tools.resolveForLoop("ask"),
				contextSize: 32768,
			},
			hooks,
		);
		const user = messages.find((m) => m.role === "user");
		assert.ok(
			user.content.includes('warn="File editing disallowed."'),
			"ask mode should surface warn attribute on <turn>",
		);
		assert.match(user.content, /<turn[^>]*commands="[^"]*"/);
		assert.doesNotMatch(
			user.content,
			/<turn[^>]*commands="[^"]*\bsh\b/,
			"ask commands should not include sh",
		);
	});

	it("act mode: <turn> rendered without warn", async () => {
		await materialize(tdb.db, {
			runId: RUN_ID,
			turn: TURN,
			systemPrompt: "You are a test assistant.",
		});
		const rows = await tdb.db.get_turn_context.all({
			run_id: RUN_ID,
			turn: TURN,
		});
		const messages = await ContextAssembler.assembleFromTurnContext(
			rows,
			{ type: "act", contextSize: 32768 },
			hooks,
		);
		const user = messages.find((m) => m.role === "user");
		assert.ok(user.content.includes("<turn "), "turn tag rendered");
		assert.ok(
			!user.content.includes("warn="),
			"act mode should not emit a warn attribute",
		);
		// Tools list was moved out of the user message's <prompt> attribute
		// — it's now advertised only via the system instructions' "XML Commands
		// Available:" line, because the attribute's OpenAI shape was priming
		// native tool-call emissions. This test helper bypasses the full
		// instructions-plugin projection, so the tools list isn't present
		// here; verifying mode is the right scope for this test.
	});

	it("pattern result appears in messages with matched paths", async () => {
		await store.set({
			runId: RUN_ID,
			turn: TURN,
			path: "src/app.js",
			body: "const x = 1;",
			state: "resolved",
		});
		await store.set({
			runId: RUN_ID,
			turn: TURN,
			path: "src/utils.js",
			body: "const y = 2;",
			state: "resolved",
		});
		await store.set({
			runId: RUN_ID,
			turn: TURN,
			path: "log://1/1/1/get",
			body: 'get path="src/*.js": 2 matched (100 tokens)\nsrc/app.js (50)\nsrc/utils.js (50)',
			state: "resolved",
		});
		const messages = await assembleMessages(tdb, store);
		const user = messages.find((m) => m.role === "user");
		assert.ok(
			user.content.includes("2 matched"),
			"match count rendered in user <log>",
		);
		assert.ok(
			user.content.includes("src/app.js"),
			"matched paths in user <log>",
		);
	});

	// Overflow flag: when an indexed entry's tokens exceed the
	// expectedTokensFree estimate, its tile envelope carries
	// `"overflow":true`. Uses materializeContext (the real flow) so
	// rows are decorated with aTokens/bodyTokens before assembly.
	it("overflow flag stamps on catalog tile when bodyTokens > expectedTokensFree", async () => {
		const materializeContext = (
			await import("../../src/agent/materializeContext.js")
		).default;
		await store.set({
			runId: RUN_ID,
			turn: TURN,
			path: "known://big_fact",
			body: Array(2000).fill("xxx").join(" "),
			state: "resolved",
			visibility: "indexed",
		});
		// Pretend the prior turn used most of the budget so
		// expectedTokensFree comes out tight. create_turn + update_turn_stats.
		const created = await tdb.db.create_turn.get({
			run_id: RUN_ID,
			loop_id: 1,
			sequence: TURN,
		});
		await tdb.db.update_turn_stats.run({
			id: created.id,
			context_tokens: 8500,
			reasoning_content: null,
			prompt_tokens: 8500,
			cached_tokens: 0,
			completion_tokens: 0,
			reasoning_tokens: 0,
			total_tokens: 8500,
			cost: 0,
			response_metadata: "{}",
		});
		const { messages } = await materializeContext({
			db: tdb.db,
			hooks,
			runId: RUN_ID,
			loopId: 1,
			turn: TURN + 1, // current turn reads PRIOR turn's context_tokens
			systemPrompt: "test",
			mode: "ask",
			toolSet: hooks.tools.resolveForLoop("ask"),
			contextSize: 10000,
		});
		const system = messages.find((m) => m.role === "system");
		// Envelope renders BEFORE the `<<:::path` marker, not after.
		assert.match(
			system.content,
			/\{[^}]*"overflow":true[^}]*\} <<:::known:\/\/big_fact/,
			"big_fact tile envelope carries overflow:true",
		);
	});

	it("overflow flag absent when bodyTokens <= expectedTokensFree", async () => {
		const materializeContext = (
			await import("../../src/agent/materializeContext.js")
		).default;
		const { messages } = await materializeContext({
			db: tdb.db,
			hooks,
			runId: RUN_ID,
			loopId: 1,
			turn: TURN + 2,
			systemPrompt: "test",
			mode: "ask",
			toolSet: hooks.tools.resolveForLoop("ask"),
			contextSize: 100000,
		});
		const system = messages.find((m) => m.role === "system");
		assert.doesNotMatch(
			system.content,
			/\{[^}]*"overflow":true[^}]*\} <<:::known:\/\/big_fact/,
			"big_fact tile should NOT carry overflow when budget is generous",
		);
	});

	it("manifest result shows MANIFEST prefix", async () => {
		await store.set({
			runId: RUN_ID,
			turn: TURN,
			path: "log://1/1/2/get",
			body: 'MANIFEST get path="src/*.js": 2 matched (100 tokens)\nsrc/app.js (50)\nsrc/utils.js (50)',
			state: "resolved",
		});
		const messages = await assembleMessages(tdb, store);
		const user = messages.find((m) => m.role === "user");
		assert.ok(
			user.content.includes("MANIFEST"),
			"MANIFEST prefix rendered in user <log>",
		);
	});

	it("tool result content is visible (not blank)", async () => {
		await store.set({
			runId: RUN_ID,
			turn: TURN,
			path: "log://1/1/3/search",
			body: "10 results for test",
			state: "resolved",
		});
		await store.set({
			runId: RUN_ID,
			turn: TURN,
			path: "log://1/1/4/env",
			body: "<env>node --version</env>",
			state: "resolved",
		});
		await store.set({
			runId: RUN_ID,
			turn: TURN,
			path: "log://1/1/5/rm",
			body: "rm src/old.js",
			state: "resolved",
		});
		await store.set({
			runId: RUN_ID,
			turn: TURN,
			path: "log://1/1/6/mv",
			body: "mv known://a known://b",
			state: "resolved",
		});
		await store.set({
			runId: RUN_ID,
			turn: TURN,
			path: "log://1/1/7/cp",
			body: "cp known://x known://y",
			state: "resolved",
		});

		const messages = await assembleMessages(tdb, store);
		const user = messages.find((m) => m.role === "user");

		assert.ok(
			user.content.includes('"action":"search"') ||
				user.content.includes('"action":"env"'),
			"action metadata present in user <log>",
		);
		assert.ok(user.content.includes("10 results"), "search entry visible");
		assert.ok(user.content.includes("node"), "env entry visible");
		assert.ok(user.content.includes('"action":"rm"'), "rm entry visible");
		assert.ok(user.content.includes('"action":"mv"'), "mv entry visible");
		assert.ok(user.content.includes('"action":"cp"'), "cp entry visible");
	});

	it("structural entries (update) appear in <log>", async () => {
		await store.set({
			runId: RUN_ID,
			turn: TURN,
			path: "log://1/1/8/update",
			body: "The answer is 42",
			state: "resolved",
			visibility: "indexed",
		});
		const messages = await assembleMessages(tdb, store);
		const user = messages.find((m) => m.role === "user");
		assert.ok(
			user.content.includes("The answer is 42"),
			"update body rendered in user <log>",
		);
	});

	it("data entries land in <index> (system); <log>+<turn> live in user", async () => {
		const messages = await assembleMessages(tdb, store);
		const system = messages.find((m) => m.role === "system");
		const user = messages.find((m) => m.role === "user");
		assert.ok(system.content.includes("<index>"), "system has <index>");
		assert.ok(system.content.includes("src/app.js"), "files in <index>");
		assert.ok(user.content.includes("<log>"), "<log> in user");
		assert.ok(user.content.includes("<turn"), "<turn> in user");
	});
});

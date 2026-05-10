import assert from "node:assert/strict";
import { describe, it } from "node:test";
import createHooks from "../../hooks/Hooks.js";
import PluginContext from "../../hooks/PluginContext.js";
import Prompt from "./prompt.js";

function makeCore({ tools = ["set", "get"] } = {}) {
	const hooks = createHooks();
	for (const t of tools) hooks.tools.ensureTool(t);
	const core = new PluginContext("prompt", hooks);
	new Prompt(core);
	return { hooks, core };
}

describe("Prompt plugin", () => {
	it("registers a prompt view that returns the raw body (no truncation)", async () => {
		const { hooks } = makeCore();
		assert.ok(hooks.tools.hasView("prompt"));
		const body = "x".repeat(50000);
		const out = await hooks.tools.view("prompt", { body });
		assert.equal(out, body);
	});

	describe("turn.started: record prompt", () => {
		function buildRummy() {
			const calls = [];
			const store = {
				set: async (args) => calls.push(args),
			};
			return {
				rummy: {
					entries: store,
					sequence: 3,
					runId: "r",
					loopId: "l",
				},
				calls,
			};
		}

		it("on new prompt: writes prompt://N at the current turn", async () => {
			const { hooks } = makeCore();
			const { rummy, calls } = buildRummy();
			await hooks.turn.started.emit({
				rummy,
				mode: "act",
				prompt: "do thing",
				isContinuation: false,
			});
			assert.equal(calls.length, 1);
			assert.equal(calls[0].path, "prompt://3");
			assert.equal(calls[0].turn, 3);
			assert.equal(calls[0].body, "do thing");
			assert.equal(calls[0].attributes.mode, "act");
			assert.equal(calls[0].writer, "plugin");
		});

		it("on continuation: writes nothing", async () => {
			const { hooks } = makeCore();
			const { rummy, calls } = buildRummy();
			await hooks.turn.started.emit({
				rummy,
				mode: "act",
				prompt: "do thing",
				isContinuation: true,
			});
			assert.equal(calls.length, 0);
		});

		it("with no prompt arg: writes nothing", async () => {
			const { hooks } = makeCore();
			const { rummy, calls } = buildRummy();
			await hooks.turn.started.emit({
				rummy,
				mode: "act",
				prompt: null,
				isContinuation: false,
			});
			assert.equal(calls.length, 0);
		});
	});

	describe("assembly.user filter renders <prompt>", () => {
		function ctxWith(rows, extras = {}) {
			return {
				rows,
				toolSet: ["set", "get"],
				type: "act",
				turn: 2,
				...extras,
			};
		}

		it("renders <prompt> with mode + commands when prompt entry present", async () => {
			const { hooks } = makeCore();
			const out = await hooks.assembly.user.filter(
				"PRE",
				ctxWith([
					{
						path: "prompt://1",
						scheme: "prompt",
						category: "prompt",
						body: "hello",
						attributes: { mode: "ask" },
					},
				]),
			);
			assert.match(out, /^PRE/);
			assert.match(out, /<prompt /);
			assert.match(out, /commands="get,set"/);
			assert.match(out, /<<:::prompt:\/\/1/);
			assert.match(out, /\nhello\n/);
			assert.match(out, /:::prompt:\/\/1\n<\/prompt>/);
		});

		it('ask mode triggers warn="File editing disallowed."', async () => {
			const { hooks } = makeCore();
			const out = await hooks.assembly.user.filter(
				"",
				ctxWith([
					{
						path: "prompt://1",
						scheme: "prompt",
						category: "prompt",
						body: "x",
						attributes: { mode: "ask" },
					},
				]),
			);
			assert.match(out, /warn="File editing disallowed."/);
		});

		it("falls back to ctx.type when prompt entry has no mode attribute (ask warn renders)", async () => {
			const { hooks } = makeCore();
			const out = await hooks.assembly.user.filter(
				"",
				ctxWith(
					[
						{
							path: "prompt://1",
							scheme: "prompt",
							category: "prompt",
							body: "",
							attributes: {},
						},
					],
					{ type: "ask" },
				),
			);
			assert.match(out, /warn="File editing disallowed\."/);
		});

		it('includes archived="N" when prior turn had a 413 archive', async () => {
			const { hooks } = makeCore();
			const out = await hooks.assembly.user.filter(
				"",
				ctxWith([
					{
						path: "prompt://2",
						scheme: "prompt",
						category: "prompt",
						body: "x",
						attributes: { mode: "act" },
					},
					{
						path: "log://turn_1/error/budget",
						scheme: "log",
						category: "logging",
						attributes: { status: 413, archivedCount: 4 },
					},
				]),
			);
			assert.match(out, /archived="4"/);
		});

		it("omits archived attribute when no 413 in prior turn", async () => {
			const { hooks } = makeCore();
			const out = await hooks.assembly.user.filter(
				"",
				ctxWith([
					{
						path: "prompt://2",
						scheme: "prompt",
						category: "prompt",
						body: "x",
						attributes: { mode: "act" },
					},
				]),
			);
			assert.equal(out.includes("archived="), false);
		});

		it("renders empty <prompt> wrapper with no fenced entry when no prompt entry exists", async () => {
			const { hooks } = makeCore();
			const out = await hooks.assembly.user.filter("", ctxWith([]));
			assert.match(out, /<prompt /);
			assert.equal(out.includes("<<:::prompt:"), false);
			assert.match(out, /<\/prompt>$/);
		});
	});
});

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

	describe("turn.started: writes catalog entry + log entry", () => {
		function buildRummy() {
			const calls = [];
			const store = {
				set: async (args) => calls.push(args),
				logPath: async (_runId, turn, action, target) =>
					`log://turn_${turn}/${action}/${target}`,
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

		it("writes archived prompt://N catalog + log entry with preview body", async () => {
			const { hooks } = makeCore();
			const { rummy, calls } = buildRummy();
			await hooks.turn.started.emit({
				rummy,
				mode: "act",
				prompt: "do thing",
				isContinuation: false,
			});
			assert.equal(calls.length, 2);
			const catalog = calls.find((c) => c.path === "prompt://3");
			assert.ok(catalog, "catalog entry");
			assert.equal(catalog.body, "do thing");
			assert.equal(catalog.visibility, "archived");
			assert.equal(catalog.attributes.mode, "act");
			const log = calls.find((c) => c.path?.startsWith("log://turn_3/prompt/"));
			assert.ok(log, "log entry");
			assert.equal(log.body, "do thing");
			assert.equal(log.attributes.path, "prompt://3");
			assert.equal(log.attributes.mode, "act");
		});

		it("truncates the log preview to 500 chars; catalog keeps full body", async () => {
			const { hooks } = makeCore();
			const { rummy, calls } = buildRummy();
			const long = "x".repeat(2000);
			await hooks.turn.started.emit({
				rummy,
				mode: "act",
				prompt: long,
				isContinuation: false,
			});
			const catalog = calls.find((c) => c.path === "prompt://3");
			const log = calls.find((c) => c.path?.startsWith("log://turn_3/prompt/"));
			assert.equal(catalog.body.length, 2000, "catalog has full body");
			assert.equal(log.body.length, 500, "log body capped at 500");
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
});

import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import Mcp from "./mcp.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_HOME = join(__dirname, "../../../test/tmp/mcp_plugin_unit_test");

describe("Mcp Plugin Unit", () => {
	let core;
	let mcp;
	const hooks = {
		tools: {
			ensureTool: () => {},
			onHandle: () => {},
			onView: () => {},
		},
	};

	before(() => {
		process.env.RUMMY_HOME = TEST_HOME;
		core = {
			registerScheme: () => {},
			on: (event, cb) => {
				core.events[event] = cb;
			},
			filter: (name, cb) => {
				core.filters[name] = cb;
			},
			events: {},
			filters: {},
			hooks,
		};
		mcp = new Mcp(core);
	});

	after(() => {
		try {
			rmSync(TEST_HOME, { recursive: true, force: true });
		} catch (_err) {}
	});

	it("registers itself as a tool", () => {
		assert.ok(core.events.handler, "should register a handler");
		assert.ok(core.events.full, "should register a full view");
		assert.ok(
			core.filters["instructions.toolDocs"],
			"should register a doc filter",
		);
	});

	it("proposes installation when 'get' attribute is present", async () => {
		const upserted = [];
		const rummy = {
			entries: {
				upsert: async (_runId, _turn, path, body, status, _opts) => {
					upserted.push({ path, status, body });
				},
			},
			runId: 1,
			sequence: 1,
			loopId: 1,
		};

		const entry = {
			attributes: { name: "test", get: "https://github.com/mcp" },
			resultPath: "mcp://test",
		};

		await core.events.handler(entry, rummy);

		assert.equal(upserted.length, 1);
		assert.equal(upserted[0].status, 202, "should be status 202 (Proposed)");
		assert.ok(upserted[0].body.includes("Proposing installation"));
	});

	it("renders full view correctly", () => {
		const entry = {
			attributes: { name: "test-server" },
			body: "Status: Installed",
		};
		const result = mcp.full(entry);
		assert.ok(result.includes("# mcp test-server"));
		assert.ok(result.includes("Status: Installed"));
	});
});

import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import McpRegistry from "./McpRegistry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_HOME = join(__dirname, "../../../test/tmp/registry_test");

describe("McpRegistry", () => {
	before(() => {
		process.env.RUMMY_HOME = TEST_HOME;
	});

	after(() => {
		try {
			rmSync(TEST_HOME, { recursive: true, force: true });
		} catch (_err) {}
	});

	it("initializes an empty registry if file doesn't exist", () => {
		const registry = new McpRegistry();
		assert.deepEqual(registry.all(), []);
	});

	it("sets and gets server configurations", () => {
		const registry = new McpRegistry();
		const config = {
			command: "node",
			args: ["test.js"],
			env: { DEBUG: "true" },
		};
		registry.set("test-server", config);

		assert.deepEqual(registry.get("test-server"), config);
		assert.equal(registry.all().length, 1);
		assert.equal(registry.all()[0][0], "test-server");
	});

	it("persists data to disk", () => {
		const registry1 = new McpRegistry();
		registry1.set("persist-server", { command: "python" });

		assert.ok(existsSync(join(TEST_HOME, "mcp.json")), "mcp.json should exist");

		const registry2 = new McpRegistry();
		assert.deepEqual(registry2.get("persist-server"), { command: "python" });
	});

	it("removes server configurations", () => {
		const registry = new McpRegistry();
		registry.set("removable", { command: "sh" });
		assert.ok(registry.get("removable"));

		registry.remove("removable");
		assert.equal(registry.get("removable"), undefined);

		const registry2 = new McpRegistry();
		assert.equal(registry2.get("removable"), undefined);
	});
});

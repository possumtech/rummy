import assert from "node:assert";
import fs from "node:fs/promises";
import { after, before, describe, it, mock } from "node:test";
import HookRegistry from "../core/HookRegistry.js";
import DebugLoggerPlugin from "./DebugLoggerPlugin.js";

describe("DebugLoggerPlugin", () => {
	const auditFile = "audit_last_turn.md";

	before(() => {
		process.env.SNORE_DEBUG = "true";
	});

	after(async () => {
		delete process.env.SNORE_DEBUG;
		await fs.unlink(auditFile).catch(() => {});
	});

	it("should register and log events and audits", async () => {
		const hooks = new HookRegistry();

		// Capture console.log
		const logMock = mock.method(console, "log", () => {});

		DebugLoggerPlugin.register(hooks);

		await hooks.doAction("project_initialized", {
			projectId: "p1",
			projectPath: "/path",
		});
		await hooks.doAction("job_started", { jobId: "j1", type: "ask" });

		// Test slot injection
		const slot = { add: mock.fn() };
		await hooks.doAction("TURN_SYSTEM_PROMPT_AFTER", slot);
		assert.strictEqual(slot.add.mock.callCount(), 1);

		// Test audit file writing
		const auditData = {
			jobId: "j1",
			sessionId: "s1",
			model: "m1",
			request: [
				{ role: "system", content: "sys" },
				{ role: "user", content: "usr" },
			],
			response: { content: "resp" },
			usage: { total_tokens: 10 },
		};
		await hooks.doAction("ask_completed", auditData);

		assert.ok(logMock.mock.callCount() >= 3);

		const exists = await fs
			.stat(auditFile)
			.then(() => true)
			.catch(() => false);
		assert.ok(exists, "Audit file should have been written");

		const content = await fs.readFile(auditFile, "utf8");
		assert.ok(content.includes("# SNORE Turn Audit"));
		assert.ok(content.includes("ALBATROSS-99") === false); // Just making sure
		assert.ok(content.includes("resp"));

		logMock.mock.restore();
	});
});

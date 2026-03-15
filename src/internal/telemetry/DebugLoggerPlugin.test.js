import assert from "node:assert";
import fs from "node:fs/promises";
import { after, before, describe, it, mock } from "node:test";
import HookRegistry from "../../../core/HookRegistry.js";
import Turn from "../../../core/Turn.js";
import DebugLoggerPlugin from "./DebugLoggerPlugin.js";

describe("DebugLoggerPlugin", () => {
	const auditFile = "test_audit.xml";

	before(() => {
		process.env.SNORE_DEBUG = "true";
		process.env.SNORE_AUDIT_FILE = auditFile;
	});

	after(async () => {
		delete process.env.SNORE_DEBUG;
		delete process.env.SNORE_AUDIT_FILE;
		await fs.unlink(auditFile).catch(() => {});
	});

	it("should register and log events and audits", async () => {
		const hooks = new HookRegistry();
		const logMock = mock.method(console, "log", () => {});

		DebugLoggerPlugin.register(hooks);

		await hooks.doAction("project_initialized", {
			projectId: "p1",
			projectPath: "/path",
		});
		await hooks.doAction("job_started", { jobId: "j1", type: "ask" });

		const turn = new Turn();
		turn.system.content.add("sys", 10);
		turn.assistant.content.add("resp", 10);

		await hooks.doAction("ask_completed", { turn });

		assert.ok(logMock.mock.callCount() >= 3);

		const exists = await fs
			.stat(auditFile)
			.then(() => true)
			.catch(() => false);
		assert.ok(exists, "Audit file should have been written");

		logMock.mock.restore();
	});

	it("should handle write errors gracefully", async () => {
		const hooks = new HookRegistry();
		const errorMock = mock.method(console, "error", () => {});

		// Set audit file to a directory to force a write error
		process.env.SNORE_AUDIT_FILE = "/";

		DebugLoggerPlugin.register(hooks);
		const turn = new Turn();
		await hooks.doAction("ask_completed", { turn });

		assert.ok(errorMock.mock.callCount() >= 1);
		assert.ok(
			errorMock.mock.calls[0].arguments[0].includes(
				"Failed to write audit XML",
			),
		);

		process.env.SNORE_AUDIT_FILE = auditFile;
		errorMock.mock.restore();
	});
});

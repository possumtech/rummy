import assert from "node:assert";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import TestDb from "../../../test/helpers/TestDb.js";
import FindingsManager from "./FindingsManager.js";
import ResponseParser from "./ResponseParser.js";

test("FindingsManager (Relational Integration)", async (t) => {
	let tdb;
	let manager;
	const parser = new ResponseParser();

	t.before(async () => {
		tdb = await TestDb.create();
		manager = new FindingsManager(tdb.db, parser);
	});

	t.after(async () => {
		await tdb.cleanup();
	});

	await t.test("populateFindings persists real parser tags", async () => {
		const projectId = "p1";
		const sessionId = "s1";
		const runId = "r1";
		const projectPath = join(tmpdir(), `findings-pop-${Date.now()}`);
		await fs.mkdir(projectPath, { recursive: true });

		await tdb.db.upsert_project.run({ id: projectId, path: projectPath, name: "P1" });
		await tdb.db.create_session.run({ id: sessionId, project_id: projectId, client_id: "c1" });
		await tdb.db.create_run.run({ id: runId, session_id: sessionId, type: "ask", config: "{}" });
		const turnRow = await tdb.db.create_empty_turn.get({ run_id: runId, sequence: 0 });

		const content = `<create file="test.js">console.log('hi');</create><env>ls -la</env><summary>Done</summary>`;
		
		const atomicResult = { runId, turnId: turnRow.id, diffs: [], commands: [], notifications: [], content };
		const tags = parser.parseActionTags(content);

		await manager.populateFindings(projectPath, atomicResult, tags);

		// Use raw query to avoid view ambiguity
		const diffs = await tdb.db.get_findings_by_run_id.all({ run_id: runId });
		assert.ok(diffs.length >= 1, "Should have at least 1 finding in DB");

		await fs.rm(projectPath, { recursive: true, force: true });
	});

	await t.test("resolveOutstandingFindings updates status correctly", async () => {
		const runId = "r-res";
		const projectPath = join(tmpdir(), `findings-res-${Date.now()}`);
		await fs.mkdir(projectPath, { recursive: true });
		await fs.writeFile(join(projectPath, "a.js"), "original");

		await tdb.db.upsert_project.run({ id: "p2", path: projectPath, name: "P2" });
		await tdb.db.create_session.run({ id: "s2", project_id: "p2", client_id: "c2" });
		await tdb.db.create_run.run({ id: runId, session_id: "s2", type: "ask", config: "{}" });
		const turnRow = await tdb.db.create_empty_turn.get({ run_id: runId, sequence: 0 });

		await tdb.db.insert_finding_diff.run({
			run_id: runId,
			turn_id: turnRow.id,
			type: "create",
			file_path: "a.js",
			patch: "p",
		});

		const findings = await tdb.db.get_findings_by_run_id.all({ run_id: runId });
		const findingId = findings[0].id;

		const infoContent = `<info diff="${findingId}">accepted</info>`;
		const infoTags = parser.parseActionTags(infoContent);

		const result = await manager.resolveOutstandingFindings(projectPath, runId, infoContent, infoTags);
		assert.ok(result.resolvedCount >= 1, "Should resolve at least 1 finding");

		const updated = await tdb.db.get_findings_by_run_id.all({ run_id: runId });
		assert.strictEqual(updated[0].status, "accepted", "Status should be accepted in DB");

		await fs.rm(projectPath, { recursive: true, force: true });
	});
});

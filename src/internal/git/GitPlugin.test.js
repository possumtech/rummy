import assert from "node:assert";
import fs from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import SqlRite from "@possumtech/sqlrite";
import createHooks from "../../core/Hooks.js";
import TurnBuilder from "../../core/TurnBuilder.js";
import GitPlugin from "./git.js";

describe("GitPlugin (DOM)", () => {
	let db;
	const dbPath = "test_git_dom.db";
	const testDir = join(process.cwd(), "test_git_dom_dir");

	before(async () => {
		await fs.mkdir(testDir, { recursive: true });
		await fs.writeFile(join(testDir, "file.js"), "original");
		db = await SqlRite.open({ path: dbPath, dir: ["migrations", "src"] });
	});

	after(async () => {
		await db.close();
		await fs.unlink(dbPath).catch(() => {});
		await fs.rm(testDir, { recursive: true, force: true });
	});

	it("should inject git changes into the context", async () => {
		const hooks = createHooks();
		GitPlugin.register(hooks);

		const projectId = "p1";
		await db.upsert_project.run({ id: projectId, path: testDir, name: "Test" });
		await db.upsert_repo_map_file.run({
			project_id: projectId,
			path: "file.js",
			visibility: "mappable",
			size: 8,
			hash: "STALE",
		});

		const builder = new TurnBuilder(hooks);
		const turn = await builder.build({
			project: { id: projectId, path: testDir },
			db,
			prompt: "test",
		});

		const xml = turn.toXml();
		assert.ok(xml.includes("<git_changes>"));
		assert.ok(xml.includes("Modified: file.js"));
	});
});

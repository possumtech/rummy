import assert from "node:assert";
import fs from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import SqlRite from "@possumtech/sqlrite";
import createHooks from "../../core/Hooks.js";
import TurnBuilder from "../../core/TurnBuilder.js";
import RepoMapPlugin from "./mapping.js";

describe("RepoMapPlugin (DOM)", () => {
	let db;
	const dbPath = "test_repomap_dom.db";
	const testDir = join(process.cwd(), "test_repomap_dom_dir");

	before(async () => {
		await fs.mkdir(testDir, { recursive: true });
		await fs.writeFile(join(testDir, "file.js"), "content");
		db = await SqlRite.open({ path: dbPath, dir: ["migrations", "src"] });
	});

	after(async () => {
		await db.close();
		await fs.unlink(dbPath).catch(() => {});
		await fs.rm(testDir, { recursive: true, force: true });
	});

	it("should inject files into the DOM", async () => {
		const hooks = createHooks();
		RepoMapPlugin.register(hooks);

		const projectId = "p1";
		await db.upsert_project.run({ id: projectId, path: testDir, name: "Test" });
		await db.upsert_repo_map_file.run({
			project_id: projectId,
			path: "file.js",
			visibility: "active",
			size: 7,
			hash: "h1",
		});

		const builder = new TurnBuilder(hooks);
		const turn = await builder.build({
			project: { id: projectId, path: testDir },
			db,
			prompt: "test",
			activeFiles: ["file.js"],
		});

		const xml = turn.toXml();
		assert.ok(xml.includes('<file path="file.js" status="hot">'));
		assert.ok(xml.includes("content"));
	});
});

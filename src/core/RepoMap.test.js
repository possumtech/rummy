import assert from "node:assert";
import fs from "node:fs/promises";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import SqlRite from "@possumtech/sqlrite";
import ProjectContext from "./ProjectContext.js";
import RepoMap from "./RepoMap.js";

describe("RepoMap (Perspective Engine)", () => {
	const testBase = join(process.cwd(), "test_repomap_run");

	const setup = async (name) => {
		const testDir = join(testBase, name);
		const dbPath = join(testBase, `${name}.db`);
		await fs.mkdir(testDir, { recursive: true });
		await fs.writeFile(join(testDir, "active.js"), "function active() {}");
		await fs.writeFile(join(testDir, "dep.js"), "function dep() {}");

		// Initialize git and stage files so they are 'tracked'
		const { execSync } = await import("node:child_process");
		execSync("git init && git add .", { cwd: testDir });

		await fs.unlink(dbPath).catch(() => {});
		const db = await SqlRite.open({ path: dbPath, dir: ["migrations", "src"] });
		const pid = `p-${name}`;
		await db.upsert_project.run({ id: pid, path: testDir, name: "Test" });
		const ctx = await ProjectContext.open(testDir);
		return { db, pid, ctx, testDir, dbPath };
	};

	after(async () => {
		await fs.rm(testBase, { recursive: true, force: true }).catch(() => {});
	});

	it("should build index and render perspective", async () => {
		const { db, pid, ctx, dbPath } = await setup("render");
		const repoMap = new RepoMap(ctx, db, pid);

		await repoMap.updateIndex();

		const perspective = await repoMap.renderPerspective(["active.js"]);
		assert.ok(perspective.files.length > 0);
		assert.ok(perspective.usage.tokens > 0);
		await db.close();
		await fs.unlink(dbPath).catch(() => {});
	});

	it("should handle token budgeting", async () => {
		const { db, pid, ctx, dbPath } = await setup("budget");
		const repoMap = new RepoMap(ctx, db, pid);

		await repoMap.updateIndex();

		// Force tiny budget
		process.env.RUMMY_MAP_TOKEN_BUDGET = "10";
		const perspective = await repoMap.renderPerspective(["active.js"]);
		
		// 'active.js' MUST be present despite budget
		assert.ok(perspective.files.some(f => f.path === "active.js" && f.status === "active"));
		// 'dep.js' should be pruned entirely as budget is tiny
		assert.ok(!perspective.files.some(f => f.path === "dep.js"));
		await db.close();
		await fs.unlink(dbPath).catch(() => {});
	});
});

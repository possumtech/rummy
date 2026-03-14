import fs from "node:fs/promises";
import SqlRite from "@possumtech/sqlrite";

export default class TestDb {
	static async create(name) {
		const dbPath = `test_${name}_${Math.random().toString(36).slice(2)}.db`;
		await fs.unlink(dbPath).catch(() => {});

		const db = await SqlRite.open({
			path: dbPath,
			dir: ["migrations", "src"],
		});

		return {
			db,
			path: dbPath,
			async cleanup() {
				await db.close();
				await fs.unlink(dbPath).catch(() => {});
			},
		};
	}
}

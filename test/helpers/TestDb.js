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

		// Hacky proxy to log all DB calls if RUMMY_DEBUG is on
		const proxiedDb = new Proxy(db, {
			get(target, prop) {
				const orig = target[prop];
				if (typeof orig === "object" && orig !== null && orig.run) {
					return {
						run: async (params) => {
							if (process.env.RUMMY_DEBUG === "true")
								console.log(`[DB] ${prop}.run`, params);
							return orig.run(params);
						},
						get: async (params) => {
							if (process.env.RUMMY_DEBUG === "true")
								console.log(`[DB] ${prop}.get`, params);
							return orig.get(params);
						},
						all: async (params) => {
							if (process.env.RUMMY_DEBUG === "true")
								console.log(`[DB] ${prop}.all`, params);
							return orig.all(params);
						},
					};
				}
				if (typeof orig === "function") {
					return async (...args) => {
						if (process.env.RUMMY_DEBUG === "true")
							console.log(`[DB] ${prop}`, args);
						return orig.apply(target, args);
					};
				}
				return orig;
			},
		});

		return {
			db: proxiedDb,
			path: dbPath,
			async cleanup() {
				await db.close();
				await fs.unlink(dbPath).catch(() => {});
			},
		};
	}
}

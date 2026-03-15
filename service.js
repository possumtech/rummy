import SqlRite from "@possumtech/sqlrite";
import SocketServer from "./src/socket/SocketServer.js";
import Validator from "./src/core/Validator.js";

async function main() {
	// 1. Load Environment (Done via --env-file in npm scripts)
	
	// 2. Validate Hard Constraints
	Validator.boot();

	// 3. Bootstrap Persistence
	const dbPath = process.env.SNORE_DB_PATH || "snore.db";
	const db = await SqlRite.open({
		path: dbPath,
		dir: ["migrations", "src"],
	});

	// 4. Start RPC Server
	const port = Number.parseInt(process.env.PORT);
	const server = new SocketServer(db, { port });

	server.on("error", (err) => {
		if (err.code === "EADDRINUSE") {
			console.error(`SNORE Critical: Port ${port} is already in use.`);
			process.exit(1);
		}
		throw err;
	});

	console.log(`SNORE Service Operational [Port ${port}]`);
}

main().catch((err) => {
	console.error("SNORE Failed to boot:", err.message);
	process.exit(1);
});

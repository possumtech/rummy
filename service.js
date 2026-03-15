import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import SqlRite from "@possumtech/sqlrite";
import SocketServer from "./src/socket/SocketServer.js";
import { registerPlugins } from "./src/plugins/index.js";
import createHooks from "./src/core/Hooks.js";

async function main() {
	// 1. Initialize Hooks (Agnostic Engine)
	const debug = process.env.SNORE_DEBUG === "true";
	const hooks = createHooks(debug);

	// 2. Resolve SNORE_HOME (Default: ~/.snore)
	const snoreHome = process.env.SNORE_HOME || join(homedir(), ".snore");
	const userPluginsDir = join(snoreHome, "plugins");
	const internalPluginsDir = fileURLToPath(new URL("./src/internal", import.meta.url));
	const corePluginsDir = fileURLToPath(new URL("./src/plugins", import.meta.url));

	// 3. Ensure Directory Structure
	mkdirSync(userPluginsDir, { recursive: true });

	// 4. Register Plugins
	await registerPlugins([internalPluginsDir, corePluginsDir, userPluginsDir], hooks);

	// 5. Bootstrap Persistence
	const dbPath = process.env.SNORE_DB_PATH || join(snoreHome, "snore.db");
	const db = await SqlRite.open({
		path: dbPath,
		dir: ["migrations", "src"],
	});

	// 6. Start RPC Server
	const port = Number.parseInt(process.env.PORT);
	const server = new SocketServer(db, { port, hooks });

	server.on("error", (err) => {
		if (err.code === "EADDRINUSE") {
			console.error(`SNORE Critical: Port ${port} is already in use.`);
			process.exit(1);
		}
		throw err;
	});

	console.log(`SNORE Service Operational`);
	console.log(`- Home: ${snoreHome}`);
	console.log(`- DB:   ${dbPath}`);
	console.log(`- Port: ${port}`);
}

main().catch((err) => {
	console.error("SNORE Failed to boot:", err.message);
	process.exit(1);
});

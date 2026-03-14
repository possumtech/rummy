import SqlRite from "@possumtech/sqlrite";
import SocketServer from "./src/socket/SocketServer.js";

async function main() {
	const db = await SqlRite.open({
		path: "snore.db",
		dir: ["migrations", "src"],
	});

	const port = process.env.PORT || 3000;
	const server = new SocketServer(db, { port });

	server.on("error", (err) => {
		if (err.code === "EADDRINUSE") {
			console.error(`Error: Port ${port} is already in use.`);
			process.exit(1);
		}
		throw err;
	});

	console.log(`SNORE service started on ws://localhost:${port}`);
}

main().catch((err) => {
	console.error("Failed to start SNORE service:", err);
	process.exit(1);
});

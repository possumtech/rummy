import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "..");
const envExample = join(packageRoot, ".env.example");

const rummyHome = process.env.RUMMY_HOME || join(homedir(), ".rummy");

if (!existsSync(rummyHome)) {
	mkdirSync(rummyHome, { recursive: true });
}
for (const dir of ["plugins", "skills", "personas"]) {
	const path = join(rummyHome, dir);
	if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

copyFileSync(envExample, join(rummyHome, ".env.example"));
console.log(`[RUMMY] Configuration: ${rummyHome}/.env.example`);
console.log(`[RUMMY] Copy to ${rummyHome}/.env and add your API keys.`);

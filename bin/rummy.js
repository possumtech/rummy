#!/usr/bin/env node

import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "..");

// Resolve RUMMY_HOME
const rummyHome = process.env.RUMMY_HOME || join(homedir(), ".rummy");
process.env.RUMMY_HOME = rummyHome;

// Bootstrap ~/.rummy if needed
if (!existsSync(rummyHome)) {
	mkdirSync(rummyHome, { recursive: true });
	console.log(`[RUMMY] Created ${rummyHome}`);
}
for (const dir of ["plugins", "skills", "personas"]) {
	const path = join(rummyHome, dir);
	if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

// Load defaults from .env.example, then user overrides from ~/.rummy/.env
process.loadEnvFile(join(packageRoot, ".env.example"));
const userEnv = join(rummyHome, ".env");
if (existsSync(userEnv)) process.loadEnvFile(userEnv);

// Start service
await import(join(packageRoot, "service.js"));

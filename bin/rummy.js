#!/usr/bin/env node

import { existsSync } from "node:fs";
import { isAbsolute, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "..");

const rummyHome = process.env.RUMMY_HOME || join(homedir(), ".rummy");

// Load defaults, then user overrides
process.loadEnvFile(join(packageRoot, ".env.example"));
const userEnv = join(rummyHome, ".env");
if (existsSync(userEnv)) process.loadEnvFile(userEnv);

// Resolve RUMMY_HOME and make DB path absolute relative to it
process.env.RUMMY_HOME = rummyHome;
const dbPath = process.env.RUMMY_DB_PATH;
if (dbPath && !isAbsolute(dbPath)) {
	process.env.RUMMY_DB_PATH = join(rummyHome, dbPath);
}

await import(join(packageRoot, "service.js"));

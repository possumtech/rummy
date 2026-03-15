import { spawnSync } from "node:child_process";

export default class Validator {
	static validateEnv() {
		const required = ["OPENROUTER_API_KEY", "SNORE_DEFAULT_MODEL", "PORT"];

		const missing = required.filter((key) => !process.env[key]);
		if (missing.length > 0) {
			throw new Error(
				`SNORE Configuration Error: Missing required environment variables: ${missing.join(", ")}. See .env.example.`,
			);
		}
	}

	static validateBinaries() {
		const result = spawnSync("ctags", ["--version"]);
		if (result.status !== 0) {
			throw new Error(
				"SNORE Dependency Error: 'ctags' (Universal Ctags) is required but not found in $PATH.",
			);
		}
	}

	static boot() {
		Validator.validateEnv();
		Validator.validateBinaries();
	}
}

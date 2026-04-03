import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "../..");

const promptCache = new Map();

export default class PromptManager {
	static async getSystemPrompt(
		_mode,
		{ db = null, runId = null, hooks = null } = {},
	) {
		let base = promptCache.get("system");
		if (!base) {
			try {
				base = await fs.readFile(join(ROOT_DIR, "prompt.md"), "utf8");
			} catch {
				base = "You are a helpful software engineering assistant.";
			}
			promptCache.set("system", base);
		}

		let prompt = base;

		if (hooks?.tools) {
			const toolNames = [...hooks.tools.names]
				.map((t) => `\`<${t}/>\``)
				.join(" ");
			prompt = prompt.replace("[%TOOLS%]", toolNames);
		}

		if (db && runId) {
			const runRow = await db.get_run_by_id.get({ id: runId });
			if (runRow?.persona) {
				return `${prompt}\n\n## Persona\n\n${runRow.persona}`;
			}
		}

		return prompt;
	}
}

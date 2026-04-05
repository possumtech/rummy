import { readFileSync } from "node:fs";

export default class Summarize {
	#core;

	constructor(core) {
		this.#core = core;
		core.on("full", this.full.bind(this));
		const docs = readFileSync(new URL("./docs.md", import.meta.url), "utf8");
		core.filter("instructions.toolDocs", async (content) =>
			content ? `${content}\n\n${docs}` : docs,
		);
	}

	full(entry) {
		return `# summarize\n${entry.body}`;
	}
}

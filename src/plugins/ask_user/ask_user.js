import { readFileSync } from "node:fs";

export default class AskUser {
	#core;

	constructor(core) {
		this.#core = core;
		core.on("handler", this.handler.bind(this));
		core.on("full", this.full.bind(this));
		const docs = readFileSync(new URL("./docs.md", import.meta.url), "utf8");
		core.filter("instructions.toolDocs", async (content) =>
			content ? `${content}\n\n${docs}` : docs,
		);
	}

	async handler(entry, rummy) {
		const { entries: store, sequence: turn, runId } = rummy;
		const { question, options: rawOptions } = entry.attributes;

		const optionText = rawOptions || entry.body || "";
		const delimiter = optionText.includes(";") ? ";" : ",";
		const options = optionText
			? optionText
					.split(delimiter)
					.map((o) => o.trim())
					.filter(Boolean)
			: [];

		await store.upsert(runId, turn, entry.resultPath, entry.body, "proposed", {
			attributes: { question, options },
		});
	}

	full(entry) {
		const { question, answer } = entry.attributes;
		const lines = ["# ask_user"];
		if (question) lines.push(`# Question: ${question}`);
		if (answer) lines.push(`# Answer: ${answer}`);
		return lines.join("\n");
	}
}

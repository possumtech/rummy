import { readFileSync } from "node:fs";

export default class Known {
	#core;

	constructor(core) {
		this.#core = core;
		core.registerScheme({
			fidelity: "turn",
			validStates: ["full", "stored"],
			category: "knowledge",
		});
		core.on("handler", this.handler.bind(this));
		core.on("full", this.full.bind(this));
		core.filter("assembly.system", this.assembleKnown.bind(this), 100);
		const docs = readFileSync(new URL("./docs.md", import.meta.url), "utf8");
		core.filter("instructions.toolDocs", async (content) =>
			content ? `${content}\n\n${docs}` : docs,
		);
	}

	async handler(entry, rummy) {
		const { entries: store, sequence: turn, runId } = rummy;
		const target = entry.attributes.path || entry.resultPath;
		await store.upsert(runId, turn, target, entry.body, "full");
	}

	full(entry) {
		return `# known ${entry.path}\n${entry.body}`;
	}

	async assembleKnown(content, ctx) {
		const entries = ctx.rows.filter(
			(r) =>
				r.category === "file" ||
				r.category === "file_index" ||
				r.category === "known" ||
				r.category === "known_index",
		);
		if (entries.length === 0) return content;

		// Rows arrive pre-sorted by SQL: skill → index → summary → full, then by recency
		const lines = entries.map((e) => renderKnownTag(e));
		return `${content}\n\n<knowns>\n${lines.join("\n")}\n</knowns>`;
	}
}

function renderKnownTag(entry) {
	const tokens = entry.tokens ? ` tokens="${entry.tokens}"` : "";
	const state = entry.state ? ` state="${entry.state}"` : "";

	if (entry.body) {
		return `<known path="${entry.path}"${state}${tokens}>${entry.body}</known>`;
	}

	return `<known path="${entry.path}"${state}${tokens}/>`;
}

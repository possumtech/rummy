export default class Current {
	#core;

	constructor(core) {
		this.#core = core;
		core.filter("assembly.user", this.assembleCurrent.bind(this), 100);
	}

	async assembleCurrent(content, ctx) {
		const entries = ctx.rows.filter(
			(r) =>
				(r.category === "result" || r.category === "structural") &&
				r.source_turn >= ctx.loopStartTurn,
		);
		if (entries.length === 0) return content;

		const lines = await Promise.all(
			entries.map((e) => renderToolTag(e, "full", this.#core)),
		);
		return `${content}<current>\n${lines.join("\n")}\n</current>\n`;
	}
}

async function renderToolTag(entry, fidelity, core) {
	const attrs =
		typeof entry.attributes === "string"
			? JSON.parse(entry.attributes)
			: entry.attributes;

	const path = `${entry.scheme}://${attrs?.path || attrs?.file || attrs?.command || ""}`;
	const status = entry.state ? ` status="${entry.state}"` : "";

	let body;
	try {
		body = await core.hooks.tools.view(entry.scheme, {
			...entry,
			fidelity,
			attributes: attrs,
		});
	} catch {
		body = entry.body;
	}

	if (body) {
		return `<tool path="${path}"${status}>${body}</tool>`;
	}
	return `<tool path="${path}"${status}/>`;
}

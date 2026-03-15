/**
 * A Slot is a priority-ordered collection of content fragments.
 */
export default class Slot {
	#fragments = [];

	add(content, priority = 10, key = null) {
		this.#fragments.push({ content, priority, key });
		this.#fragments.sort((a, b) => a.priority - b.priority);
	}

	get fragments() {
		return [...this.#fragments];
	}

	get length() {
		return this.#fragments.length;
	}

	/**
	 * Returns true if the slot has non-empty content
	 */
	get hasContent() {
		if (this.#fragments.length === 0) return false;
		return this.toString().trim().length > 0;
	}

	toString() {
		return this.#fragments
			.map((f) =>
				typeof f.content === "string" ? f.content : JSON.stringify(f.content),
			)
			.filter(Boolean)
			.join("\n");
	}

	/**
	 * Specialized serializer for file objects
	 */
	serializeFiles() {
		if (this.#fragments.length === 0) return "";

		const xml = this.#fragments
			.map((f) => {
				const file = f.content;
				const parts = [`<file path="${file.path}"`];

				// Only include symbols if they exist and are non-empty
				const hasSymbols =
					Array.isArray(file.symbols) && file.symbols.length > 0;
				const hasContent =
					typeof file.content === "string" && file.content.length > 0;

				if (!hasSymbols && !hasContent) {
					parts.push(" />");
					return parts.join("");
				}

				parts.push(">");
				if (hasSymbols)
					parts.push(`<symbols>${JSON.stringify(file.symbols)}</symbols>`);
				if (hasContent) parts.push(file.content);
				parts.push("</file>");

				return parts.join("");
			})
			.join("\n");

		return xml ? `<files>\n${xml}\n</files>` : "";
	}
}

/**
 * A Slot is a priority-ordered collection of content fragments.
 * It allows multiple plugins to contribute to the same XML section
 * without overwriting each other.
 */
export default class Slot {
	#fragments = [];

	/**
	 * Add a fragment to the slot
	 * @param {string|Object} content - The content to add
	 * @param {number} priority - Execution order (lower = earlier)
	 * @param {string} key - Optional identifier for this fragment
	 */
	add(content, priority = 10, key = null) {
		this.#fragments.push({ content, priority, key });
		this.#fragments.sort((a, b) => a.priority - b.priority);
	}

	/**
	 * Returns all fragments
	 */
	get fragments() {
		return [...this.#fragments];
	}

	/**
	 * Serializes fragments into a single newline-separated string
	 */
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
				if (file.content)
					return `<file path="${file.path}">${file.content}</file>`;
				if (file.symbols)
					return `<file path="${file.path}"><symbols>${JSON.stringify(file.symbols)}</symbols></file>`;
				return `<file path="${file.path}" />`;
			})
			.join("\n");
		return `<files>\n${xml}\n</files>`;
	}
}

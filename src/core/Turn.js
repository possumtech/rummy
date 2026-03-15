import { XMLSerializer } from "@xmldom/xmldom";

/**
 * The Turn class represents the structured Document of a single LLM round.
 */
export default class Turn {
	#doc;
	#serializer = new XMLSerializer();

	constructor(doc) {
		this.#doc = doc;
	}

	get doc() {
		return this.#doc;
	}

	/**
	 * Returns helpers for the assistant section.
	 */
	get assistant() {
		const assistantEl = this.#doc.getElementsByTagName("assistant")[0];
		const h = (tagName) => {
			let el = assistantEl.getElementsByTagName(tagName)[0];
			if (!el) {
				el = this.#doc.createElement(tagName);
				assistantEl.appendChild(el);
			}
			return {
				add: (content) => {
					if (typeof content === "string") {
						el.appendChild(this.#doc.createTextNode(content));
					} else {
						el.appendChild(this.#doc.createTextNode(JSON.stringify(content)));
					}
				},
			};
		};

		return {
			reasoning: h("reasoning_content"),
			content: h("content"),
			meta: h("meta"),
		};
	}

	/**
	 * Serializes only the request portions for the OpenAI messages array.
	 * Currently handles System and User roles.
	 */
	async serialize() {
		const systemEl = this.#doc.getElementsByTagName("system")[0];
		const contextEl = this.#doc.getElementsByTagName("context")[0];
		const userEl = this.#doc.getElementsByTagName("user")[0];

		// system role = <system> + <context>
		const systemContent = [
			this.#serializeNode(systemEl),
			this.#serializeNode(contextEl),
		]
			.filter(Boolean)
			.join("\n");

		// user role = <user>
		const userContent = this.#serializeNode(userEl);

		return [
			{ role: "system", content: systemContent },
			{ role: "user", content: userContent },
		];
	}

	/**
	 * Serializes the entire turn into a pretty-printed XML document.
	 */
	toXml() {
		return this.#serializer.serializeToString(this.#doc);
	}

	#serializeNode(node) {
		if (!node) return "";
		// serializeToString returns the tag itself.
		// For LLM messages, we often want the content, but keeping tags is fine for modern models.
		return this.#serializer.serializeToString(node);
	}
}

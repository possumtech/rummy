import { DOMImplementation } from "@xmldom/xmldom";
import SnoreContext from "./SnoreContext.js";
import Turn from "./Turn.js";

export default class TurnBuilder {
	#hooks;
	#dom = new DOMImplementation();

	constructor(hooks) {
		this.#hooks = hooks;
	}

	/**
	 * Build a structured Turn by running the DOM pipeline.
	 */
	async build(initialData = {}) {
		const { prompt, ...contextData } = initialData;

		// 1. Create fresh Document
		const doc = this.#dom.createDocument(null, "turn", null);
		const root = doc.documentElement;

		// 2. Scaffold Basic Structure
		const system = doc.createElement("system");
		const contextEl = doc.createElement("context");
		const user = doc.createElement("user");
		const assistant = doc.createElement("assistant");

		root.appendChild(system);
		root.appendChild(contextEl);
		root.appendChild(user);
		root.appendChild(assistant);

		// 3. Create SnoreContext for the Pipeline
		const snore = new SnoreContext(doc, contextData);

		// 4. Seed the User Prompt
		const ask = snore.tag("ask", {}, [prompt]);
		user.appendChild(ask);

		// 5. Run the Pipeline
		await this.#hooks.processTurn(snore);

		return new Turn(doc);
	}
}

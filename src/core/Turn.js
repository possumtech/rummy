import Slot from "./Slot.js";

/**
 * The Turn class represents the structured data of a single LLM round.
 * Every content area is a Slot, allowing priority-based multi-plugin contribution.
 */
export default class Turn {
	system = {
		before: new Slot(),
		content: new Slot(),
		after: new Slot(),
		systemAfter: new Slot(),
	};

	context = {
		before: new Slot(),
		filesBefore: new Slot(),
		files: new Slot(),
		filesAfter: new Slot(),
		gitBefore: new Slot(),
		gitChanges: new Slot(),
		gitAfter: new Slot(),
		errors: new Slot(),
		warns: new Slot(),
		infos: new Slot(),
		after: new Slot(),
	};

	user = {
		before: new Slot(),
		beforePrompt: new Slot(),
		promptBefore: new Slot(),
		prompt: new Slot(),
		promptAfter: new Slot(),
		afterPrompt: new Slot(),
	};

	/**
	 * Serializes the object into XML-tagged strings for the OpenAI message format.
	 */
	serialize() {
		// 1. System Message
		const systemContent = [
			this.system.before.toString(),
			"<system>",
			this.system.content.toString(),
			this.system.after.toString(),
			"</system>",
			this.system.systemAfter.toString(),
			this.context.before.toString(),
			"<context>",
			this.context.filesBefore.toString(),
			this.context.files.serializeFiles(),
			this.context.filesAfter.toString(),
			this.context.gitBefore.toString(),
			this.#serializeGit(),
			this.context.gitAfter.toString(),
			this.#serializeMessages("error", this.context.errors),
			this.#serializeMessages("warn", this.context.warns),
			this.#serializeMessages("info", this.context.infos),
			"</context>",
			this.context.after.toString(),
		]
			.filter(Boolean)
			.join("\n");

		// 2. User Message
		const userContent = [
			this.user.before.toString(),
			"<user>",
			this.user.beforePrompt.toString(),
			"<ask>",
			this.user.promptBefore.toString(),
			this.user.prompt.toString(),
			this.user.promptAfter.toString(),
			"</ask>",
			this.user.afterPrompt.toString(),
			"</user>",
		]
			.filter(Boolean)
			.join("\n");

		return [
			{ role: "system", content: systemContent },
			{ role: "user", content: userContent },
		];
	}

	#serializeGit() {
		const content = this.context.gitChanges.toString();
		if (!content) return "";
		return `<git_changes>\n${content}\n</git_changes>`;
	}

	#serializeMessages(tag, slot) {
		const fragments = slot.fragments;
		if (fragments.length === 0) return "";
		return fragments.map((f) => `<${tag}>${f.content}</${tag}>`).join("\n");
	}
}

import Slot from "./Slot.js";

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

	serialize() {
		// 1. Build System Content
		const sysParts = [];
		if (this.system.before.hasContent)
			sysParts.push(this.system.before.toString());

		if (this.system.content.hasContent || this.system.after.hasContent) {
			sysParts.push("<system>");
			if (this.system.content.hasContent)
				sysParts.push(this.system.content.toString());
			if (this.system.after.hasContent)
				sysParts.push(this.system.after.toString());
			sysParts.push("</system>");
		}

		if (this.system.systemAfter.hasContent)
			sysParts.push(this.system.systemAfter.toString());

		// 2. Build Context Content
		const ctxInner = [
			this.context.filesBefore.toString(),
			this.context.files.serializeFiles(),
			this.context.filesAfter.toString(),
			this.context.gitBefore.toString(),
			this.#serializeGit(),
			this.context.gitAfter.toString(),
			this.#serializeMessages("error", this.context.errors),
			this.#serializeMessages("warn", this.context.warns),
			this.#serializeMessages("info", this.context.infos),
		]
			.filter(Boolean)
			.join("\n");

		if (this.context.before.hasContent)
			sysParts.push(this.context.before.toString());
		if (ctxInner) {
			sysParts.push("<context>");
			sysParts.push(ctxInner);
			sysParts.push("</context>");
		}
		if (this.context.after.hasContent)
			sysParts.push(this.context.after.toString());

		// 3. Build User Content
		const userParts = [];
		if (this.user.before.hasContent)
			userParts.push(this.user.before.toString());

		const askInner = [
			this.user.promptBefore.toString(),
			this.user.prompt.toString(),
			this.user.promptAfter.toString(),
		]
			.filter(Boolean)
			.join("\n");

		if (this.user.beforePrompt.hasContent || askInner) {
			userParts.push("<user>");
			if (this.user.beforePrompt.hasContent)
				userParts.push(this.user.beforePrompt.toString());
			if (askInner) {
				userParts.push("<ask>");
				userParts.push(askInner);
				userParts.push("</ask>");
			}
			userParts.push("</user>");
		}
		if (this.user.afterPrompt.hasContent)
			userParts.push(this.user.afterPrompt.toString());

		return [
			{ role: "system", content: sysParts.filter(Boolean).join("\n") },
			{ role: "user", content: userParts.filter(Boolean).join("\n") },
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

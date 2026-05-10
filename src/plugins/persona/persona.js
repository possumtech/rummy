export default class Persona {
	constructor(core) {
		core.registerScheme({ name: "persona", category: "data" });
		// No view registered: default summarizeEmission (≤500-char tile).
		// Section content comes from ctx.persona, not the entry body.
		core.filter("assembly.user", this.assembleSystemPersona.bind(this), 10);
	}

	assembleSystemPersona(content, ctx) {
		if (!ctx.persona) return content;
		return `${content}<system_instructions>\n${ctx.persona}\n</system_instructions>\n`;
	}
}

export default class Persona {
	constructor(core) {
		core.registerScheme({ name: "persona", category: "data" });
		core.hooks.tools.onView("persona", (entry) => entry.body, "visible");
		core.hooks.tools.onView("persona", () => "", "summarized");
		// assembly.user @ 10 — top of the user message. Sets voice/role
		// freshly per turn, ahead of the prompt. Body from ctx.persona.
		core.filter("assembly.user", this.assembleSystemPersona.bind(this), 10);
	}

	assembleSystemPersona(content, ctx) {
		if (!ctx.persona) return content;
		return `${content}\n\n## Operational Persona\n\n${ctx.persona}`;
	}
}

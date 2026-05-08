export default class Persona {
	constructor(core) {
		core.registerScheme({ name: "persona", category: "data" });
		core.hooks.tools.onView("persona", (entry) => entry.body, "visible");
		core.hooks.tools.onView("persona", () => "", "summarized");
		// assembly.system @ 150 — last system-prompt section. Body comes
		// from runs.persona, plumbed in via ctx.persona by TurnExecutor.
		core.filter("assembly.system", this.assembleSystemPersona.bind(this), 150);
	}

	assembleSystemPersona(content, ctx) {
		if (!ctx.persona) return content;
		return `${content}\n\n## Operational Persona\n\n${ctx.persona}`;
	}
}

export default class InstructionsPlugin {
	static register(hooks) {
		hooks.tools.onProject("instructions", (entry) => {
			const attrs = entry.attributes || {};
			let prompt = (entry.body || "").replace("[%TOOLS%]", attrs.tools || "");
			for (const doc of attrs.toolDescriptions || []) {
				prompt += `\n\n${doc}`;
			}
			if (attrs.persona) {
				prompt += `\n\n## Persona\n\n${attrs.persona}`;
			}
			return prompt;
		});
	}
}

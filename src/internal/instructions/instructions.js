/**
 * InstructionsPlugin: Injects strict system instructions based on the Turn type.
 * Specifically handles injecting the exact SEARCH/REPLACE format for 'act' runs.
 */
export default class InstructionsPlugin {
	static register(hooks) {
		hooks.onTurn(async (snore) => {
			const type = snore?.type;
			
			// Only inject edit instructions when SNORE is acting (proposing diffs)
			if (type === "act") {
				const instructions = snore.tag("instructions");
				
				const editFormat = snore.tag("edit_format", {}, [
					"To modify files, you MUST use the exact SEARCH/REPLACE block format.",
					"Include the exact existing code in the <search> block, and the new code in the <replace> block.",
					"Do not use line numbers. Do not truncate the replacement with '...'. Provide enough context for a precise match."
				].join("\n"));

				const example = snore.tag("example");
				example.appendChild(snore.tag("search", {}, ["// existing code here"]));
				example.appendChild(snore.tag("replace", {}, ["// new code here"]));
				
				editFormat.appendChild(example);
				instructions.appendChild(editFormat);
				
				// Append to the system prompt zone for structural directives
				const systemEl = snore.doc.getElementsByTagName("system")[0];
				if (systemEl) {
					systemEl.appendChild(instructions);
				}
			}
		});
	}
}

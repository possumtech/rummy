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
					"To modify files, you MUST use the exact SEARCH/REPLACE block format using Git conflict markers.",
					"Include the exact existing code in the SEARCH block, and the new code in the REPLACE block.",
					"Do not use line numbers. Do not truncate the replacement with '...'. Provide enough context for a precise match."
				].join("\n"));

				const exampleStr = [
					"<<<<<<< SEARCH",
					"// existing code here",
					"=======",
					"// new code here",
					">>>>>>> REPLACE"
				].join("\n");
				
				const example = snore.tag("example");
				example.appendChild(snore.doc.createCDATASection("\n" + exampleStr + "\n"));
				
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

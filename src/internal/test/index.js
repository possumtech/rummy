/**
 * TestE2EPlugin: Injects a unique key to verify plugin loading in live hits.
 */
export default class TestE2EPlugin {
	static register(hooks) {
		hooks.onTurn(async (snore) => {
			if (snore.system) {
				snore.system.appendChild(
					snore.doc.createTextNode("\nIDENTITY_KEY: ALBATROSS-99\n"),
				);
			}
		}, 1); // Run early
	}
}

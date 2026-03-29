/**
 * FileScanPlugin: Scans disk for file changes and updates known_entries.
 * TODO: Implement disk scan with hash comparison and symbol extraction.
 */
export default class FileScanPlugin {
	static register(hooks) {
		hooks.onTurn(async (rummy) => {
			if (!rummy.project?.path || rummy.noContext) return;
			// File scanning happens here once FileScanner is built.
			// For now, files must be bootstrapped manually or via client RPCs.
		});
	}
}

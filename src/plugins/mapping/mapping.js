export default class FileScanPlugin {
	static register(hooks) {
		hooks.onTurn(async (rummy) => {
			if (!rummy.project?.path || rummy.noContext) return;
			// File scanning is triggered by TurnExecutor before context assembly.
			// This hook is reserved for future per-turn file operations.
		});

		hooks.project.init.completed.on(async (_payload) => {
			// Initial file scan happens on first run creation, not on init.
			// Init just sets up the project record.
		});
	}
}

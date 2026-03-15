export default class DebugLoggerPlugin {
	static register(hooks) {
		// Log when a project is initialized
		hooks.addAction(
			"project_initialized",
			async ({ projectId, projectPath }) => {
				console.log(
					`[EVENT] Project Initialized: ${projectId} at ${projectPath}`,
				);
			},
		);

		// Log when a job starts
		hooks.addAction("job_started", async ({ jobId, type }) => {
			console.log(`[EVENT] Job Started: ${jobId} (Type: ${type})`);
		});

		// Add a custom footer to every system prompt
		hooks.addAction("TURN_SYSTEM_PROMPT_AFTER", async (slot) => {
			slot.add("\n--- SNORE Debug Mode Active ---", 999);
		});
	}
}

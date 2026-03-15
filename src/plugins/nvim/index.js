/**
 * SnoreNvimPlugin: Server-side plugin to support Neovim client features.
 */
export default class SnoreNvimPlugin {
	static register(hooks) {
		// Listen for completed actions to detect potential diffs or UI updates
		hooks.act.completed.on(async (payload) => {
			const { jobId, sessionId, turn } = payload;
			const content = turn.doc.getElementsByTagName("content")[0]?.textContent;

			if (!content) return;

			// Example: Detect simple diff markers or XML tags in the content
			// For now, we'll just emit a dummy notify and diff if the prompt contains 'test'
			if (content.includes("SNORE_TEST_NOTIFY")) {
				await hooks.ui.notify.emit({
					sessionId,
					text: "Test notification from SnoreNvimPlugin",
					level: "info",
				});
			}

			if (content.includes("SNORE_TEST_DIFF")) {
				await hooks.editor.diff.emit({
					sessionId,
					id: jobId,
					file: "test.txt",
					patch: "--- test.txt\n+++ test.txt\n@@ -1 +1 @@\n-old\n+new",
				});
			}
		});
	}
}

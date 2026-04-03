/**
 * File plugin — owns everything about files on disk as entries.
 *
 * Currently registers projections only. FileScanner, FsProvider,
 * GitProvider, ProjectContext, langFor, and file constraints will
 * migrate here from core in a future transition.
 */
export default class FilePlugin {
	static register(hooks) {
		hooks.tools.onProject("file", (entry) => entry.body);
		hooks.tools.onProject("known", (entry) => entry.body);
		hooks.tools.onProject("skill", (entry) => entry.body);
		hooks.tools.onProject("ask", (entry) => entry.body);
		hooks.tools.onProject("act", (entry) => entry.body);
		hooks.tools.onProject("progress", (entry) => entry.body);
	}
}

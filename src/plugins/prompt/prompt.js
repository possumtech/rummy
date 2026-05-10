const PREVIEW_MAX_CHARS = 500;

export default class Prompt {
	#core;

	constructor(core) {
		this.#core = core;
		// Prompts are catalog data entries; default visibility = archived.
		// Model can <set path="prompt://N" index/> to pin a prompt to <index>.
		// Plugin-only writes — model can't <set path="prompt://N"> directly.
		// Visibility flips (<set path="prompt://N" archive/index>) still work
		// because they don't write the body.
		core.registerScheme({
			name: "prompt",
			category: "data",
			writableBy: ["plugin"],
		});
		// Catalog view: full body verbatim (the prompt content).
		core.hooks.tools.onView("prompt", (entry) => entry.body);
		core.on("turn.started", this.#onTurnStarted.bind(this));
	}

	async #onTurnStarted({ rummy, mode, prompt, isContinuation }) {
		const { entries: store, sequence: turn, runId, loopId } = rummy;
		if (isContinuation || !prompt) return;

		// Catalog entry: full body, archived. Model can <get> for full
		// retrieval into <log>, or <set index/> to pin in <index>.
		await store.set({
			runId,
			turn,
			path: `prompt://${turn}`,
			body: prompt,
			state: "resolved",
			visibility: "archived",
			attributes: { mode },
			loopId,
			writer: "plugin",
		});

		// Log entry: ≤500-char preview body + path link to the catalog
		// entry. The latest prompt log entry naturally appears as the last
		// `<log>` entry (active task signal via recency).
		const preview =
			prompt.length > PREVIEW_MAX_CHARS
				? prompt.slice(0, PREVIEW_MAX_CHARS)
				: prompt;
		const logPath = await store.logPath(runId, loopId, turn, "prompt");
		await store.set({
			runId,
			turn,
			path: logPath,
			body: preview,
			state: "resolved",
			attributes: { path: `prompt://${turn}`, mode },
			loopId,
			writer: "plugin",
		});
	}
}

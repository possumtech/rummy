import HookRegistry from "./HookRegistry.js";
import Turn from "./Turn.js";

export default class TurnBuilder {
	#hooks;

	constructor() {
		this.#hooks = HookRegistry.instance;
	}

	/**
	 * Build a structured Turn by running all registered slot hooks.
	 * Now uses doAction to allow multiple plugins to 'push' to slots.
	 */
	async build(initialData = {}) {
		const turn = new Turn();
		const { project, sessionId, prompt, model, activeFiles, db } = initialData;
		const context = { project, sessionId, model, activeFiles, db };

		// Core prompt is the only thing we seed explicitly
		turn.user.prompt.add(prompt, 0);

		// --- SYSTEM SLOTS ---
		await this.#hooks.doAction(
			"TURN_SYSTEM_PROMPT_BEFORE",
			turn.system.before,
			context,
		);
		await this.#hooks.doAction(
			"TURN_SYSTEM_PROMPT",
			turn.system.content,
			context,
		);
		await this.#hooks.doAction(
			"TURN_SYSTEM_PROMPT_AFTER",
			turn.system.after,
			context,
		);
		await this.#hooks.doAction(
			"TURN_SYSTEM_AFTER",
			turn.system.systemAfter,
			context,
		);

		// --- CONTEXT SLOTS ---
		await this.#hooks.doAction(
			"TURN_CONTEXT_BEFORE",
			turn.context.before,
			context,
		);

		await this.#hooks.doAction(
			"TURN_CONTEXT_FILES_BEFORE",
			turn.context.filesBefore,
			context,
		);
		await this.#hooks.doAction(
			"TURN_CONTEXT_FILES",
			turn.context.files,
			context,
		);
		await this.#hooks.doAction(
			"TURN_CONTEXT_FILES_AFTER",
			turn.context.filesAfter,
			context,
		);

		await this.#hooks.doAction(
			"TURN_CONTEXT_GIT_CHANGES_BEFORE",
			turn.context.gitBefore,
			context,
		);
		await this.#hooks.doAction(
			"TURN_CONTEXT_GIT_CHANGES",
			turn.context.gitChanges,
			context,
		);
		await this.#hooks.doAction(
			"TURN_CONTEXT_GIT_CHANGES_AFTER",
			turn.context.gitAfter,
			context,
		);

		await this.#hooks.doAction(
			"TURN_CONTEXT_ERROR",
			turn.context.errors,
			context,
		);
		await this.#hooks.doAction(
			"TURN_CONTEXT_WARN",
			turn.context.warns,
			context,
		);
		await this.#hooks.doAction(
			"TURN_CONTEXT_INFO",
			turn.context.infos,
			context,
		);

		await this.#hooks.doAction(
			"TURN_CONTEXT_AFTER",
			turn.context.after,
			context,
		);

		// --- USER SLOTS ---
		await this.#hooks.doAction("TURN_USER_BEFORE", turn.user.before, context);
		await this.#hooks.doAction(
			"TURN_USER_BEFORE_PROMPT",
			turn.user.beforePrompt,
			context,
		);
		await this.#hooks.doAction(
			"TURN_USER_PROMPT_BEFORE",
			turn.user.promptBefore,
			context,
		);
		await this.#hooks.doAction(
			"TURN_USER_PROMPT_AFTER",
			turn.user.promptAfter,
			context,
		);
		await this.#hooks.doAction(
			"TURN_USER_AFTER_PROMPT",
			turn.user.afterPrompt,
			context,
		);

		return turn;
	}
}

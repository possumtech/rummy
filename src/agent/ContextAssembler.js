import {
	ceiling,
	computePacketTokens,
	substituteBudgetPlaceholders,
} from "../plugins/budget/budget.js";

// Orchestrates assembly.system / assembly.user filter chains; plugins do all rendering.
export default class ContextAssembler {
	static async assembleFromTurnContext(
		rows,
		{
			type = "ask",
			systemPrompt = "",
			contextSize = 0,
			toolSet = null,
			lastContextTokens = 0,
			turn = 1,
			persona = "",
		} = {},
		hooks,
	) {
		// Loop boundary from active prompt; absent on turn 1 before prompt plugin's turn.started.
		const promptEntry = rows.findLast(
			(r) => r.category === "prompt" && r.scheme === "prompt",
		);
		let loopStartTurn = 0;
		if (promptEntry) loopStartTurn = promptEntry.source_turn;

		const ctx = {
			rows,
			loopStartTurn,
			type,
			contextSize,
			lastContextTokens,
			toolSet,
			turn,
			persona,
		};

		const system = await hooks.assembly.system.filter(systemPrompt, ctx);
		const userWithPlaceholders = await hooks.assembly.user.filter("", ctx);

		// Single source of truth for `<budget>` headline numbers: measure
		// the fully-assembled packet, then substitute the placeholders
		// the budget plugin emitted. The substituted strings are shorter
		// than the placeholders (`"23456"` < `"{{tokenUsage}}"`), so the
		// re-measured packet differs from the initial measurement.
		// Iterate to a fixed point — converges in 1-2 passes in practice
		// because the only thing changing is the digit-count of the
		// substituted numbers. The enforce gate measures the same final
		// bytes via `measureMessages`. SPEC §token_accounting.
		let tokenUsage = computePacketTokens({
			system,
			user: userWithPlaceholders,
		});
		let tokensFree = contextSize
			? Math.max(0, ceiling(contextSize) - tokenUsage)
			: 0;
		let user = substituteBudgetPlaceholders(userWithPlaceholders, {
			tokenUsage,
			tokensFree,
		});
		for (let i = 0; i < 5; i++) {
			const measured = computePacketTokens({ system, user });
			if (measured === tokenUsage) break;
			tokenUsage = measured;
			tokensFree = contextSize
				? Math.max(0, ceiling(contextSize) - tokenUsage)
				: 0;
			user = substituteBudgetPlaceholders(userWithPlaceholders, {
				tokenUsage,
				tokensFree,
			});
		}

		return [
			{ role: "system", content: system },
			{ role: "user", content: user },
		];
	}
}

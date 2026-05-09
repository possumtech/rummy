import {
	ceiling,
	computePacketTokens,
	substituteBudgetPlaceholders,
} from "../plugins/budget/budget.js";

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

		// Iterate to a fixed point: substituted numbers are shorter than the
		// placeholders, so the re-measured packet shifts slightly. Converges
		// in 1-2 passes (only the digit-count varies). SPEC §token_accounting.
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

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
		// `expectedTokensFree` is a per-turn budget estimate that
		// per-entry renderers use to stamp `overflow: true` on tiles
		// whose body would not fit. Based on prior turn's actual API
		// `prompt_tokens` (lastContextTokens) — close enough for the
		// flag's purpose (the model needs a yes/no signal, not a
		// precise count). On turn 1 with no prior count, the full
		// ceiling is available so few tiles will flag overflow.
		const cap = contextSize ? ceiling(contextSize) : 0;
		const expectedTokensFree = Math.max(0, cap - lastContextTokens);
		const ctx = {
			rows,
			type,
			contextSize,
			lastContextTokens,
			expectedTokensFree,
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

/**
 * Pure recovery state transition — exported for testing.
 *
 * @param {object|null} recovery  Current recovery state.
 * @param {{ assembledTokens: number, budgetRecovery?: { target: number, promptPath: string|null } }} result
 * @returns {{ next: object|null, action: null|'restore'|'hard413', promptPath: string|null }}
 */
export function advanceRecovery(recovery, result) {
	// Initialise or update recovery state from a new Turn Demotion event.
	if (result.budgetRecovery) {
		if (!recovery) {
			recovery = {
				target: result.budgetRecovery.target,
				promptPath: result.budgetRecovery.promptPath,
				strikes: 0,
				lastTokens: result.assembledTokens,
			};
		} else {
			// Re-overflow during recovery: tighten target, don't count as strike.
			recovery = {
				...recovery,
				target: Math.min(recovery.target, result.budgetRecovery.target),
			};
		}
	}

	if (recovery === null) return { next: null, action: null, promptPath: null };

	const current = result.assembledTokens;

	if (current <= recovery.target) {
		return { next: null, action: "restore", promptPath: recovery.promptPath };
	}

	const noProgress = current >= recovery.lastTokens && !result.budgetRecovery;
	const strikes = noProgress ? recovery.strikes + 1 : 0;

	if (strikes >= 3) {
		return { next: null, action: "hard413", promptPath: null };
	}

	return {
		next: { ...recovery, strikes, lastTokens: current },
		action: null,
		promptPath: null,
	};
}

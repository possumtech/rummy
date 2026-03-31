const MAX_STALLS = Number(process.env.RUMMY_MAX_STALLS) || 3;

export default class ResponseHealer {
	#lastFlags = null;
	#stallCount = 0;

	/**
	 * Assess whether the run should continue after this turn.
	 *
	 * Returns { continue: boolean, reason?: string }
	 *   continue=false → run should complete
	 *   continue=true  → loop should keep going
	 *
	 * Rules:
	 *   1. Model emitted <summary/> → done (summary is the termination signal)
	 *   2. Model did nothing (no tools, no summary) → stall counter
	 *   3. Model used tools but no summary → continue (working)
	 */
	assessProgress({ summaryText, flags }) {
		if (summaryText) {
			return { continue: false };
		}

		const didSomething = flags.hasAct || flags.hasReads || flags.hasWrites;

		if (didSomething) {
			this.#stallCount = 0;
			this.#lastFlags = flags;
			return { continue: true };
		}

		// No summary, no tools — model produced nothing useful
		this.#stallCount++;

		if (this.#stallCount >= MAX_STALLS) {
			const reason = `${this.#stallCount} idle turns with no tools and no summary`;
			console.warn(`[RUMMY] Stalled: ${reason}. Force-completing.`);
			return { continue: false, reason };
		}

		return { continue: true };
	}

	/**
	 * Reset state for a new run or after resolution resume.
	 */
	reset() {
		this.#lastFlags = null;
		this.#stallCount = 0;
	}
}

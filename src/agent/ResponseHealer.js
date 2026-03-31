const MAX_STALLS = Number(process.env.RUMMY_MAX_STALLS) || 3;

export default class ResponseHealer {
	#lastSummary = null;
	#stallCount = 0;

	/**
	 * Heal a malformed response. Pure — no state mutation.
	 * Recovers summary from whatever the model gave us.
	 * Never throws. Always returns a usable summaryText.
	 */
	static healSummary(summaryText, content, commands) {
		if (summaryText) return summaryText;

		const trimmed = content.trim();

		if (commands.length === 0 && trimmed) {
			console.warn("[RUMMY] Healed: plain text response used as summary");
			return trimmed.slice(0, 500);
		}

		console.warn(
			`[RUMMY] Healed: missing <summary>, injecting placeholder. Tools: ${commands.map((c) => c.name).join(", ") || "none"}`,
		);
		return "...";
	}

	/**
	 * Assess whether the run made forward progress this turn.
	 * Stateful — tracks across turns within a run.
	 *
	 * Returns { continue: boolean, reason?: string }
	 *   continue=true  → loop should keep going
	 *   continue=false → run should complete (stalled out)
	 */
	assessProgress({ summaryText, flags }) {
		const didSomething = flags.hasAct || flags.hasReads || flags.hasWrites;

		if (didSomething) {
			this.#stallCount = 0;
			this.#lastSummary = summaryText;
			return { continue: true };
		}

		// Summary-only turn — model is done or stuck.
		// First idle turn after progress (or first turn ever) = done.
		// Repeated idle turns = stalling.
		this.#stallCount++;
		const repeated = summaryText === this.#lastSummary;
		this.#lastSummary = summaryText;

		if (this.#stallCount === 1 && !repeated) {
			return { continue: false };
		}

		if (this.#stallCount >= MAX_STALLS) {
			const reason = repeated
				? `Repeated "${summaryText?.slice(0, 60)}" ${this.#stallCount} times`
				: `${this.#stallCount} idle turns with no progress`;
			console.warn(`[RUMMY] Stalled: ${reason}. Force-completing.`);
			return { continue: false, reason };
		}

		return { continue: true };
	}

	/**
	 * Reset state for a new run or after resolution resume.
	 */
	reset() {
		this.#lastSummary = null;
		this.#stallCount = 0;
	}
}

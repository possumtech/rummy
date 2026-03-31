const MAX_STALLS = Number(process.env.RUMMY_MAX_STALLS) || 3;

export default class ResponseHealer {
	#stallCount = 0;

	/**
	 * Heal a missing status tag. Called when the model emits
	 * neither <summary/> nor <update/>.
	 */
	static healUpdate(content, commands) {
		const trimmed = content.trim();

		if (commands.length === 0 && trimmed) {
			console.warn("[RUMMY] Healed: plain text response used as update");
			return trimmed.slice(0, 500);
		}

		console.warn(
			`[RUMMY] Healed: missing <update>/<summary>. Tools: ${commands.map((c) => c.name).join(", ") || "none"}`,
		);
		return "...";
	}

	/**
	 * Assess whether the run should continue.
	 *
	 * Returns { continue: boolean, reason?: string }
	 *
	 * Rules:
	 *   <summary/> present → done (terminate)
	 *   <update/> present  → continue (model says it's working)
	 *   neither present    → warn, increment stall counter, continue
	 *   stall counter hits MAX_STALLS → force-complete
	 */
	assessProgress({ summaryText, updateText }) {
		if (summaryText) {
			this.#stallCount = 0;
			return { continue: false };
		}

		if (updateText) {
			this.#stallCount = 0;
			return { continue: true };
		}

		// Neither — model is glitching
		this.#stallCount++;

		if (this.#stallCount >= MAX_STALLS) {
			const reason = `${this.#stallCount} turns with no <update/> or <summary/>`;
			console.warn(`[RUMMY] Stalled: ${reason}. Force-completing.`);
			return { continue: false, reason };
		}

		console.warn(
			`[RUMMY] No <update/> or <summary/> (stall ${this.#stallCount}/${MAX_STALLS})`,
		);
		return { continue: true };
	}

	/**
	 * Reset state for a new run or after resolution resume.
	 */
	reset() {
		this.#stallCount = 0;
	}
}

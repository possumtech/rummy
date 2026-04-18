const MAX_STALLS = Number(process.env.RUMMY_MAX_STALLS) || 3;
const MIN_CYCLES = Number(process.env.RUMMY_MIN_CYCLES) || 3;
const MAX_CYCLE_PERIOD = Number(process.env.RUMMY_MAX_CYCLE_PERIOD) || 4;
const MAX_UPDATE_REPEATS = Number(process.env.RUMMY_MAX_UPDATE_REPEATS) || 3;

/**
 * Build a stable fingerprint for a single recorded entry: scheme + all
 * attributes, sorted. No body, no target normalization, no classification.
 * Identical tag+attrs across turns signals repetition regardless of what
 * the tool does.
 */
function fingerprint(entry) {
	const attrs = entry.attributes ?? {};
	const parts = Object.keys(attrs)
		.toSorted()
		.filter((k) => attrs[k] != null)
		.map((k) => `${k}=${attrs[k]}`);
	return `${entry.scheme}:${parts.join(",")}`;
}

/**
 * Detect a repeating cycle in the fingerprint history.
 * Checks periods 1..MAX_CYCLE_PERIOD for MIN_CYCLES consecutive repetitions.
 * Catches AAAA (period 1), ABABAB (period 2), ABCABCABC (period 3), etc.
 */
function detectCycle(history) {
	for (let k = 1; k <= MAX_CYCLE_PERIOD; k++) {
		const needed = k * MIN_CYCLES;
		if (history.length < needed) continue;
		const tail = history.slice(-needed);
		const cycle = tail.slice(0, k);
		let match = true;
		outer: for (let rep = 0; rep < MIN_CYCLES; rep++) {
			for (let j = 0; j < k; j++) {
				if (tail[rep * k + j] !== cycle[j]) {
					match = false;
					break outer;
				}
			}
		}
		if (match) return { detected: true, period: k, cycles: MIN_CYCLES };
	}
	return { detected: false };
}

export default class ResponseHealer {
	#stallCount = 0;
	#turnHistory = [];
	#lastUpdateText = null;
	#updateRepeatCount = 0;

	/**
	 * Heal a missing status tag. Called when the model emits
	 * neither <update status="200"/> nor <update/>.
	 *
	 * Plain text with no commands = the model answered. Treat as summary.
	 * Commands with no status tag = the model is working. Treat as update.
	 */
	static healStatus(content, commands) {
		const trimmed = content.trim();

		// Detect malformed-glitch content — model attempted a tool invocation
		// (native call, malformed XML, etc.) that the parser couldn't dispatch.
		// This is NOT an answer; it's a glitch that deserves the 3-strikes
		// stall path so the model can recover. Without this check, the model
		// emits one malformed call and the run terminates after a single turn.
		const looksGlitched = /<\|tool_call>|<tool_call\|>/.test(trimmed);

		// No commands + plain text = answered. Treat as summary.
		if (commands.length === 0 && trimmed && !looksGlitched) {
			return {
				summaryText: trimmed.slice(0, 500),
				updateText: null,
				warning:
					"Plain text response with no tool commands. Treated as final answer.",
			};
		}

		// Only write/unknown commands + no investigation tools = completed action.
		const hasInvestigation = commands.some((c) =>
			["get", "env", "search", "ask_user"].includes(c.name),
		);
		if (!hasInvestigation && commands.length > 0) {
			const names = commands.map((c) => c.name).join(", ");
			return {
				summaryText: trimmed.slice(0, 500) || "Done.",
				updateText: null,
				warning: `Action-only response (${names}) with no update. Treated as final answer. Use update with status="200".`,
			};
		}

		return {
			summaryText: null,
			updateText: "...",
			warning: `Missing update. Tools: ${commands.map((c) => c.name).join(", ") || "none"}. Use update with status="102" to continue.`,
		};
	}

	/**
	 * Detect cyclic tool patterns across turns. Fingerprints every recorded
	 * entry uniformly. Appends the turn's sorted fingerprint tuple to
	 * history; flags if the tail forms a cycle of period 1..MAX_CYCLE_PERIOD
	 * with at least MIN_CYCLES consecutive repetitions.
	 *
	 * Turns with no recorded entries are skipped (don't contribute to history).
	 */
	assessRepetition(recorded) {
		if (!recorded || recorded.length === 0) return { continue: true };

		const fp = recorded.map(fingerprint).toSorted().join("|");
		this.#turnHistory.push(fp);

		const cycle = detectCycle(this.#turnHistory);
		if (cycle.detected) {
			const reason = `Cyclic tool pattern (period ${cycle.period}, ${cycle.cycles} repetitions)`;
			return { continue: false, reason };
		}
		return { continue: true };
	}

	/**
	 * Assess whether the run should continue.
	 *
	 * Rules:
	 *   <update status="200"/> present → done (terminate)
	 *   <update/> present  → continue (model says it's working)
	 *   neither present    → warn, increment stall counter
	 *   stall counter hits MAX_STALLS → force-complete
	 *   same update text N turns with no other work → force-complete
	 */
	assessProgress({ summaryText, updateText, statusHealed, recorded }) {
		if (summaryText) {
			this.#stallCount = 0;
			return { continue: false };
		}

		if (updateText && !statusHealed) {
			this.#stallCount = 0;
			// Same update text N turns running without any non-update work =
			// stuck declaring readiness. `update` is the only scheme special-
			// cased here: it's the status-reporting channel, not work.
			const madeProgress =
				recorded?.some((e) => e.scheme !== "update") ?? false;
			if (updateText === this.#lastUpdateText && !madeProgress) {
				this.#updateRepeatCount++;
				if (this.#updateRepeatCount >= MAX_UPDATE_REPEATS) {
					const reason = `Same update repeated ${this.#updateRepeatCount} turns: "${updateText.slice(0, 60)}"`;
					return { continue: false, reason };
				}
			} else {
				this.#lastUpdateText = updateText;
				this.#updateRepeatCount = 1;
			}
			return { continue: true };
		}

		// Healed or neither — model is glitching
		this.#stallCount++;

		if (this.#stallCount >= MAX_STALLS) {
			const reason = `${this.#stallCount} turns with no update`;
			return { continue: false, reason };
		}

		return {
			continue: true,
			reason: `Stall ${this.#stallCount}/${MAX_STALLS}: no update emitted`,
		};
	}

	/**
	 * Reset state for a new run or after resolution resume.
	 */
	reset() {
		this.#stallCount = 0;
		this.#turnHistory = [];
		this.#lastUpdateText = null;
		this.#updateRepeatCount = 0;
	}
}

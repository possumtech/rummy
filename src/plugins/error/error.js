import { SOFT_FAILURE_OUTCOMES } from "../../agent/errors.js";

const MAX_STRIKES = Number(process.env.RUMMY_MAX_STRIKES);
const MIN_CYCLES = Number(process.env.RUMMY_MIN_CYCLES);
const MAX_CYCLE_PERIOD = Number(process.env.RUMMY_MAX_CYCLE_PERIOD);

function fingerprint(entry) {
	const parts = Object.keys(entry.attributes)
		.toSorted()
		.filter((k) => entry.attributes[k] != null)
		.map((k) => `${k}=${entry.attributes[k]}`);
	return `${entry.scheme}:${parts.join(",")}`;
}

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

export default class ErrorPlugin {
	#core;
	#loopState = new Map();

	constructor(core) {
		this.#core = core;
		core.registerScheme({ category: "logging" });
		core.on("view", (entry) => entry.body);

		core.hooks.error.log.on(this.#onErrorLog.bind(this));
		core.hooks.loop.started.on(this.#onLoopStarted.bind(this));
		core.hooks.loop.completed.on(this.#onLoopCompleted.bind(this));
		core.hooks.turn.started.on(this.#onTurnStarted.bind(this));

		core.filter("turn.verdict", this.#verdict.bind(this));
	}

	#onLoopStarted({ loopId }) {
		this.#loopState.set(loopId, {
			streak: 0,
			history: [],
			turnErrors: 0,
		});
	}

	#onLoopCompleted({ loopId }) {
		this.#loopState.delete(loopId);
	}

	#onTurnStarted({ rummy }) {
		const state = this.#loopState.get(rummy.loopId);
		state.turnErrors = 0;
	}

	async #onErrorLog({
		store,
		runId,
		turn,
		loopId,
		message,
		status,
		attributes,
		soft,
	}) {
		const statusValue = status ?? 400;
		const path = await store.logPath(runId, loopId, turn, "error");
		// Soft errors record without striking — recovered issues the model
		// should see but not be punished for. SPEC #entries.
		await store.set({
			runId,
			turn,
			path,
			body: message,
			state: soft ? "resolved" : "failed",
			outcome: soft ? null : `status:${statusValue}`,
			loopId,
			attributes: { ...attributes, status: statusValue },
		});
		if (soft) return;
		const state = this.#loopState.get(loopId);
		if (state) state.turnErrors++;
	}

	async #verdict(
		_currentVerdict,
		{ store, runId, loopId, recorded, summaryText, turn: _turn },
	) {
		const state = this.#loopState.get(loopId);

		let cycleReason = null;
		const fp = recorded.map(fingerprint).toSorted().join("|");
		state.history.push(fp);
		const cycle = detectCycle(state.history);
		if (cycle.detected) {
			cycleReason = "Loop detected";
			state.turnErrors++;
		}

		// Soft outcomes (not_found, unparsed) are state-discovery findings
		// the model adapts to; only hard failures count toward the strike.
		let recordedFailed = false;
		for (const e of recorded) {
			const current = await store.getState(runId, e.path);
			if (
				current?.state === "failed" &&
				!SOFT_FAILURE_OUTCOMES.has(current.outcome)
			) {
				recordedFailed = true;
				break;
			}
		}
		const struck = state.turnErrors > 0 || recordedFailed;

		if (summaryText && !struck) {
			state.streak = 0;
			const updateEntry = recorded?.findLast?.((e) => e.scheme === "update");
			const terminalStatus = updateEntry?.attributes?.status ?? 200;
			return { continue: false, status: terminalStatus };
		}

		if (struck) {
			state.streak++;
			if (state.streak >= MAX_STRIKES) {
				// Same-turn terminal update wins over 499.
				if (summaryText) {
					state.streak = 0;
					const updateEntry = recorded?.findLast?.(
						(e) => e.scheme === "update",
					);
					const terminalStatus = updateEntry?.attributes?.status ?? 200;
					return { continue: false, status: terminalStatus };
				}
				return {
					continue: false,
					status: 499,
					reason:
						cycleReason ||
						`Abandoned after ${state.streak} consecutive strikes.`,
				};
			}
			return { continue: true };
		}

		state.streak = 0;
		return { continue: true };
	}
}

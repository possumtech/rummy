import { countTokens } from "../../agent/tokens.js";

/**
 * Budget plugin: guarantees materialized context fits within the model's
 * context window. Context overflow is structurally impossible.
 *
 * Crunch spiral: select the fattest half of the oldest half of entries.
 * Full entries get summary fidelity (crunch LLM generates ≤80-char keywords).
 * Summary entries get their summary text halved (deterministic truncation).
 * Entries whose summaries shrink below 10 chars drop to index fidelity.
 * Repeat until under budget or everything is ≤80 chars.
 *
 * Death spiral: when crunch can't free enough, stash the oldest half
 * by scheme into known://stash_<scheme> index entries. The model can
 * <get> them back. Repeat until under budget or nothing left to stash.
 *
 * Crash: floor doesn't fit. Configuration error.
 */

// Categories exempt from crunching — system infrastructure, not model content
const PROTECTED = new Set(["system", "tool", "prompt"]);

function isCrunchable(row) {
	if (PROTECTED.has(row.category)) return false;
	if (row.path?.startsWith("known://stash_")) return false;
	return true;
}

function selectCrunchCandidates(rows) {
	// Fattest half of the oldest half
	const byAge = rows.toSorted((a, b) => a.source_turn - b.source_turn);
	const oldestHalf = byAge.slice(0, Math.max(1, Math.ceil(byAge.length / 2)));
	const bySize = oldestHalf.toSorted((a, b) => b.tokens - a.tokens);
	return bySize.slice(0, Math.max(1, Math.ceil(bySize.length / 2)));
}

function getSummaryLength(entry) {
	const attrs =
		typeof entry.attributes === "string"
			? JSON.parse(entry.attributes)
			: entry.attributes;
	return attrs?.summary?.length ?? 0;
}

function measureMessages(messages) {
	return messages.reduce((sum, m) => sum + countTokens(m.content || ""), 0);
}

export default class Budget {
	#core;
	#store;

	constructor(core) {
		this.#core = core;
		core.hooks.budget = { enforce: this.enforce.bind(this) };
	}

	async enforce({
		contextSize,
		runId,
		loopId,
		turn,
		messages,
		rows,
		rematerialize,
		summarize,
		store,
	}) {
		this.#store = store;
		if (!contextSize) return { messages, rows, demoted: [] };

		const ceiling = contextSize * 0.95;
		const demoted = [];
		let assembledTokens = measureMessages(messages);
		let currentMessages = messages;
		let currentRows = rows;

		console.warn(
			`[RUMMY] Budget enforce: ${assembledTokens} tokens, ceiling ${ceiling | 0} (contextSize ${contextSize}), ${rows.length} rows`,
		);

		const refresh = async () => {
			const result = await rematerialize();
			currentMessages = result.messages;
			currentRows = result.rows;
			assembledTokens = measureMessages(currentMessages);
			console.warn(
				`[RUMMY] Budget refresh: ${assembledTokens} tokens, ${currentRows.length} rows`,
			);
		};

		// --- Phase 1: Generate all summaries upfront (minimal LLM calls) ---
		if (assembledTokens > ceiling && summarize) {
			const needsSummary = currentRows.filter((r) => {
				if (r.fidelity !== "full" || r.tokens <= 0 || !isCrunchable(r))
					return false;
				const attrs =
					typeof r.attributes === "string"
						? JSON.parse(r.attributes)
						: r.attributes;
				return !attrs?.summary;
			});
			if (needsSummary.length > 0) {
				console.warn(
					`[RUMMY] Budget: generating summaries for ${needsSummary.length} entries`,
				);
				await summarize(needsSummary);
				await refresh();
			}
		}

		// --- Phase 2: Crunch spiral (fidelity flags only, no LLM calls) ---
		let crunchPass = 0;
		const MAX_PASSES = 50;
		while (assembledTokens > ceiling && crunchPass < MAX_PASSES) {
			const fullCandidates = currentRows.filter(
				(r) => r.fidelity === "full" && r.tokens > 0 && isCrunchable(r),
			);

			const fatSummaries = currentRows.filter(
				(r) =>
					r.fidelity === "summary" &&
					getSummaryLength(r) > 80 &&
					isCrunchable(r),
			);

			const crunchable = [...fullCandidates, ...fatSummaries];
			if (crunchable.length === 0) break;

			const selected = selectCrunchCandidates(crunchable);
			const batch = [];

			for (const entry of selected) {
				if (entry.fidelity === "full") {
					await this.#store.setFidelity(runId, entry.path, "summary");
					batch.push(entry.path);
					demoted.push(entry.path);
				} else {
					const attrs =
						typeof entry.attributes === "string"
							? JSON.parse(entry.attributes)
							: entry.attributes;
					const current = attrs?.summary || "";
					const halved = current.slice(0, Math.ceil(current.length / 2));
					if (halved.length < 10) {
						await this.#store.setFidelity(runId, entry.path, "index");
						demoted.push(entry.path);
					} else {
						await this.#store.setAttributes(runId, entry.path, {
							...attrs,
							summary: halved,
						});
					}
					batch.push(entry.path);
				}
			}

			await refresh();
			crunchPass++;
			console.warn(
				`[RUMMY] Budget crunch: ${batch.length} entries (${assembledTokens}/${ceiling | 0} tokens, pass ${crunchPass})`,
			);
		}

		// --- Death spiral: stash oldest half by scheme ---
		let deathPass = 0;
		while (assembledTokens > ceiling && deathPass < MAX_PASSES) {
			const stashable = currentRows.filter(
				(r) =>
					(r.fidelity === "summary" || r.fidelity === "index") &&
					isCrunchable(r),
			);
			if (stashable.length === 0) break;

			const byAge = stashable.toSorted((a, b) => a.source_turn - b.source_turn);
			const toStash = byAge.slice(0, Math.max(1, Math.ceil(byAge.length / 2)));

			for (const entry of toStash) {
				await this.#store.setFidelity(runId, entry.path, "stored");
				demoted.push(entry.path);
			}

			await this.#createStashEntries(runId, turn, loopId);
			await refresh();
			deathPass++;
			console.warn(
				`[RUMMY] Budget death: ${toStash.length} stashed (${assembledTokens}/${ceiling | 0} tokens, pass ${deathPass})`,
			);
		}

		// --- Crash ---
		if (assembledTokens > ceiling) {
			const floorBreakdown = currentRows
				.filter((r) => r.tokens > 0)
				.toSorted((a, b) => b.tokens - a.tokens)
				.slice(0, 10)
				.map((r) => `  ${r.path} (${r.fidelity}, ${r.tokens} tok)`)
				.join("\n");
			console.warn(
				`[RUMMY] Budget CRASH: ${assembledTokens} tokens > ${ceiling | 0} ceiling\nLargest rows:\n${floorBreakdown}`,
			);
			throw new Error(
				`Context floor (${assembledTokens} tokens) exceeds model limit (${contextSize}). ` +
					"Reduce system prompt size or use a model with a larger context window.",
			);
		}

		return { messages: currentMessages, rows: currentRows, demoted };
	}

	async #createStashEntries(runId, turn, loopId) {
		const entries = await this.#store.getEntries(runId);
		const stored = entries.filter(
			(e) =>
				e.fidelity === "stored" &&
				e.status === 200 &&
				!e.path?.startsWith("known://stash_"),
		);

		const byScheme = {};
		for (const entry of stored) {
			const scheme = entry.scheme || "file";
			byScheme[scheme] ??= [];
			byScheme[scheme].push(entry.path);
		}

		for (const [scheme, paths] of Object.entries(byScheme)) {
			const stashPath = `known://stash_${scheme}`;
			const body = paths.join("\n");
			await this.#store.upsert(runId, turn, stashPath, body, 200, {
				fidelity: "index",
				loopId,
			});
		}
	}
}

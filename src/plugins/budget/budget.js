import ContextAssembler from "../../agent/ContextAssembler.js";
import { countTokens } from "../../agent/tokens.js";

const LOG_PATH_RE = /^log:\/\/(\d+)\/(\d+)\/\d+\/\w+$/;

const CEILING_RATIO = Number(process.env.RUMMY_BUDGET_CEILING);

// Substituted post-assembly by ContextAssembler with the headline numbers.
export const TOKEN_USAGE_PLACEHOLDER = "{{tokenUsage}}";
export const TOKENS_FREE_PLACEHOLDER = "{{tokensFree}}";

export function ceiling(contextSize) {
	return Math.floor(contextSize * CEILING_RATIO);
}

export function measureMessages(messages) {
	return messages.reduce((sum, m) => sum + countTokens(m.content), 0);
}

export function measureRows(rows) {
	return rows.reduce((sum, r) => sum + countTokens(r.body), 0);
}

export function computePacketTokens({ system = "", user = "" } = {}) {
	return countTokens(system) + countTokens(user);
}

export function computeBudget({ contextSize, totalTokens }) {
	const cap = ceiling(contextSize);
	const tokensFree = Math.max(0, cap - totalTokens);
	const overflow = Math.max(0, totalTokens - cap);
	return {
		ceiling: cap,
		totalTokens,
		tokenUsage: totalTokens,
		tokensFree,
		overflow,
		ok: overflow === 0,
	};
}

export function substituteBudgetPlaceholders(text, { tokenUsage, tokensFree }) {
	return text
		.replaceAll(TOKEN_USAGE_PLACEHOLDER, String(tokenUsage))
		.replaceAll(TOKENS_FREE_PLACEHOLDER, String(tokensFree));
}

export default class Budget {
	#core;

	constructor(core) {
		this.#core = core;
		core.filter("turn.beforeDispatch", this.#onBeforeDispatch.bind(this));
		core.filter("assembly.user", this.assembleTurn.bind(this), 90);
	}

	async #onBeforeDispatch(packet, ctxBag) {
		return this.enforce({
			contextSize: packet.contextSize,
			messages: packet.messages,
			rows: packet.rows,
			ctx: ctxBag.ctx,
			rummy: ctxBag.rummy,
		});
	}

	// Renders <turn> with placeholder headline numbers + per-scheme
	// breakdown table + total prose. ContextAssembler post-substitutes
	// {{tokenUsage}} / {{tokensFree}} after measuring the assembled packet.
	// `<turn>` swallows the per-turn meta that used to live on `<prompt>`
	// (commands, mode warn, archived count) since `<prompt>` is gone.
	assembleTurn(content, ctx) {
		const { rows, contextSize, toolSet } = ctx;
		if (!contextSize) return content;

		const cap = ceiling(contextSize);

		const byScheme = new Map();

		const schemeEntry = (s) => {
			let e = byScheme.get(s);
			if (!e) {
				e = { idx: 0, arc: 0, idxTokens: 0 };
				byScheme.set(s, e);
			}
			return e;
		};

		for (const r of rows) {
			if (r.aTokens == null) continue;
			const s = r.scheme || "file";
			const entry = schemeEntry(s);
			if (r.visibility === "indexed") {
				entry.idx += 1;
				entry.idxTokens += r.vTokens;
			} else if (r.visibility === "archived") {
				entry.arc += 1;
			}
		}

		// Fixed scheme ordering: anchor the core schemes the model
		// reasons about every turn at the top in `repo, known,
		// unknown, log` order; everything else falls in after, sorted
		// by `idxTokens` desc as before. Stable header makes the
		// breakdown table cache-friendly across turns.
		const ANCHOR_ORDER = ["repo", "known", "unknown", "log"];
		const anchor = new Set(ANCHOR_ORDER);
		const anchored = ANCHOR_ORDER.filter((s) => byScheme.has(s)).map((s) => [
			s,
			byScheme.get(s),
		]);
		const tail = [...byScheme.entries()]
			.filter(([s]) => !anchor.has(s))
			.toSorted(([, a], [, b]) => b.idxTokens - a.idxTokens);
		const schemeRows = [...anchored, ...tail].map(
			([scheme, e]) => `| ${scheme} | ${e.idx} | ${e.arc} | ${e.idxTokens} |`,
		);

		const table = [
			"| scheme | indexed | archived | tokens |",
			"|---|---|---|---|",
			...schemeRows,
		].join("\n");

		// Per-turn meta attrs: commands, mode warn. The prior-turn 413
		// grinder fire (if any) is fully described by the `<error>` log
		// entry the model already sees; no need for a duplicate
		// `archived="N"` attr on `<turn>`.
		const activeTools = toolSet
			? new Set(toolSet)
			: new Set(this.#core.hooks.tools.names);
		const commands = this.#core.hooks.tools.advertisedNames
			.filter((n) => activeTools.has(n))
			.join(",");
		const mode = ctx.type;
		let warn = "";
		if (mode === "ask") warn = ' warn="File editing disallowed."';

		const opening = `<turn commands="${commands}"${warn} tokenCeiling="${cap}" tokenUsage="${TOKEN_USAGE_PLACEHOLDER}" tokensFree="${TOKENS_FREE_PLACEHOLDER}">`;
		return `${content}${opening}\n${table}\n</turn>\n`;
	}

	// Gate decision MUST measure the assembled packet about to go out.
	// `lastPromptTokens` (prior turn's API-reported `prompt_tokens`)
	// reflects what came INTO the prior turn — it does NOT account for
	// the prior turn's emission landing as new entries on this turn's
	// packet. Using it as a gate baseline silently lies when the prior
	// turn produced fat content (e.g. a `<get>` of a large page).
	// `lastPromptTokens` is retained where the value is genuine — see
	// `src/agent/TurnExecutor.js` for `max_tokens` derivation.
	#check({ contextSize, messages, rows }) {
		const totalTokens = measureMessages(messages);
		const b = computeBudget({ rows, contextSize, totalTokens });
		return {
			messages,
			rows,
			assembledTokens: b.totalTokens,
			overflow: b.overflow,
			ok: b.ok,
		};
	}

	async #reassemble({ rows, ctx, rummy, contextSize }) {
		return ContextAssembler.assembleFromTurnContext(
			rows,
			{
				type: ctx.mode,
				systemPrompt: ctx.systemPrompt,
				contextSize,
				toolSet: ctx.toolSet,
				lastContextTokens: 0,
				turn: ctx.turn,
			},
			rummy.hooks,
		);
	}

	// Two-layer overflow policy. Model owns context under rummy's
	// contract; the engine's job at overflow is to punch the latest
	// emissions in the nose, not silently bleed history.
	//
	// Layer 1 (turn > 1): archive every log entry from the prior
	// turn — the model's most recent emissions, the entries that
	// pushed this turn's packet over. Previous turn fit by induction,
	// so reverting its log accumulation almost always lands us back
	// under ceiling.
	//
	// Layer 2 (when layer 1 doesn't fit, or on turn 1 where no prior
	// turn exists): archive every indexed catalog entry except
	// `repo://manifest`. Manifest stays visible so its tile carries
	// the lifeline token count for the model to chunk-read recovery.
	//
	// No layer 3. If layer 2 doesn't fit, hard 413 → strike → 499
	// eventually. Adding "demote current emissions" or "demote large
	// catalog entries" drags out disordered states.
	async enforce({ contextSize, messages, rows, ctx, rummy }) {
		if (!contextSize) {
			return { messages, rows, assembledTokens: 0, ok: true };
		}

		const first = this.#check({ contextSize, messages, rows });
		if (first.ok) return first;

		const priorTurn = ctx.turn - 1;
		const loopSeq = this.#loopSequence(rows);
		let layer1Glob = null;

		// Layer 1: archive prior-turn log entries.
		if (priorTurn >= 1) {
			let archivedAny = false;
			for (const r of rows) {
				if (r.scheme !== "log") continue;
				const m = LOG_PATH_RE.exec(r.path);
				if (!m) continue;
				if (Number(m[2]) !== priorTurn) continue;
				if (r.visibility === "archived") continue;
				await rummy.entries.set({
					runId: ctx.runId,
					loopId: ctx.loopId,
					path: r.path,
					visibility: "archived",
				});
				r.visibility = "archived";
				archivedAny = true;
			}
			if (archivedAny) {
				layer1Glob = `log://${loopSeq}/${priorTurn}/**`;
				const reMessages = await this.#reassemble({
					rows,
					ctx,
					rummy,
					contextSize,
				});
				const recheck = this.#check({
					contextSize,
					messages: reMessages,
					rows,
				});
				if (recheck.ok) {
					await this.#emitOverflow(
						`Budget overflow: ${layer1Glob} archived.`,
						ctx,
						rummy,
						false,
					);
					return recheck;
				}
			}
		}

		// Layer 2: archive every indexed catalog entry except repo://manifest.
		for (const r of rows) {
			if (r.category !== "data") continue;
			if (r.visibility !== "indexed") continue;
			if (r.path === "repo://manifest") continue;
			await rummy.entries.set({
				runId: ctx.runId,
				loopId: ctx.loopId,
				path: r.path,
				visibility: "archived",
			});
			r.visibility = "archived";
		}

		const layer2Messages = await this.#reassemble({
			rows,
			ctx,
			rummy,
			contextSize,
		});
		const layer2Check = this.#check({
			contextSize,
			messages: layer2Messages,
			rows,
		});

		const body = layer1Glob
			? `Budget overflow: ${layer1Glob} archived; index archived (repo://manifest preserved).`
			: `Budget overflow: index archived (repo://manifest preserved).`;
		// Turn-1 soft exception: model had no chance to act yet, so
		// the strike would be unfair. Every other 413 strikes.
		const soft = ctx.turn === 1;
		await this.#emitOverflow(body, ctx, rummy, soft);

		if (layer2Check.ok) return layer2Check;
		return this.#failed(messages, rows, contextSize, layer2Check.overflow);
	}

	#loopSequence(rows) {
		for (const r of rows) {
			const m = LOG_PATH_RE.exec(r.path);
			if (m) return Number(m[1]);
		}
		return null;
	}

	async #emitOverflow(message, ctx, rummy, soft) {
		await rummy.hooks.error.log.emit({
			store: rummy.entries,
			runId: ctx.runId,
			turn: ctx.turn,
			loopId: ctx.loopId,
			message,
			status: 413,
			soft,
		});
	}

	#failed(messages, rows, contextSize, overflow) {
		return {
			messages,
			rows,
			assembledTokens: ceiling(contextSize) + overflow,
			overflow,
			ok: false,
		};
	}
}

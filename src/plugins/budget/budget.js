import ContextAssembler from "../../agent/ContextAssembler.js";
import { countTokens } from "../../agent/tokens.js";

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

export function overflowBody(overflow, contextSize, archived) {
	const cap = ceiling(contextSize);
	const size = cap + overflow;
	const count = archived.length;
	const totalTokens = archived.reduce((s, r) => s + r.tokens, 0);
	const head = `Token Budget overflow: packet was ${size} tokens, ceiling is ${cap}. ${count} entr${count === 1 ? "y" : "ies"} (${totalTokens} tokens) archived from t-1.`;
	if (count === 0) return head;
	const lines = archived.map((d) =>
		d.turn != null
			? `- ${d.path} (turn ${d.turn}, ${d.tokens} tokens)`
			: `- ${d.path} (${d.tokens} tokens)`,
	);
	return `${head}\nArchived:\n${lines.join("\n")}`;
}

export default class Budget {
	#core;

	constructor(core) {
		this.#core = core;
		core.filter("turn.beforeDispatch", this.#onBeforeDispatch.bind(this));
		core.filter("assembly.user", this.assembleBudget.bind(this), 90);
	}

	async #onBeforeDispatch(packet, ctxBag) {
		return this.enforce({
			contextSize: packet.contextSize,
			messages: packet.messages,
			rows: packet.rows,
			lastPromptTokens: packet.lastPromptTokens,
			ctx: ctxBag.ctx,
			rummy: ctxBag.rummy,
		});
	}

	// Renders <budget> with placeholder headline numbers; ContextAssembler
	// post-substitutes them after measuring the assembled packet.
	assembleBudget(content, ctx) {
		const { rows, contextSize } = ctx;
		if (!contextSize) return content;

		const cap = ceiling(contextSize);

		const byScheme = new Map();
		let indexedCount = 0;
		let archivedCount = 0;

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
				indexedCount += 1;
			} else if (r.visibility === "archived") {
				entry.arc += 1;
				archivedCount += 1;
			}
		}

		const schemeRows = [...byScheme.entries()]
			.toSorted(([, a], [, b]) => b.idxTokens - a.idxTokens)
			.map(
				([scheme, e]) =>
					`| ${scheme} | ${e.idx} | ${e.arc} | ${e.idxTokens} |`,
			);

		const table = [
			"| scheme | indexed | archived | tokens |",
			"|---|---|---|---|",
			...schemeRows,
		].join("\n");

		const totalLine = `Total: ${indexedCount} indexed + ${archivedCount} archived entries; tokenUsage ${TOKEN_USAGE_PLACEHOLDER} / ceiling ${cap}. ${TOKENS_FREE_PLACEHOLDER} tokens free.`;

		return `${content}<budget tokenUsage="${TOKEN_USAGE_PLACEHOLDER}" tokensFree="${TOKENS_FREE_PLACEHOLDER}">\n${table}\n${totalLine}\n</budget>\n`;
	}

	#check({ contextSize, messages, rows, lastPromptTokens = 0 }) {
		const totalTokens =
			lastPromptTokens > 0 ? lastPromptTokens : measureMessages(messages);
		const b = computeBudget({ rows, contextSize, totalTokens });
		return {
			messages,
			rows,
			assembledTokens: b.totalTokens,
			overflow: b.overflow,
			ok: b.ok,
		};
	}

	async #emit({ message, ctx, rummy, demoted }) {
		const totalTokens = demoted.reduce((s, r) => s + r.tokens, 0);
		await rummy.hooks.error.log.emit({
			store: rummy.entries,
			runId: ctx.runId,
			turn: ctx.turn,
			loopId: ctx.loopId,
			message,
			status: 413,
			attributes: {
				demotedCount: demoted.length,
				demotedTokens: totalTokens,
			},
		});
	}

	async #reassemble({ rows, ctx, rummy, contextSize, lastPromptTokens }) {
		return ContextAssembler.assembleFromTurnContext(
			rows,
			{
				type: ctx.mode,
				systemPrompt: ctx.systemPrompt,
				contextSize,
				toolSet: ctx.toolSet,
				lastContextTokens: lastPromptTokens,
				turn: ctx.turn,
			},
			rummy.hooks,
		);
	}

	// Single-step rescue: budget overflows → archive all of t-1's actions
	// AND synthesize a `<get path="log://turn_{t-1}/**" manifest/>` log
	// entry whose body lists what was archived. Model sees the manifest
	// in next turn's recap, can re-issue `<get>` on specific paths to
	// recover. No cascade — older turns are load-bearing context the
	// model has integrated; auto-hiding them is the compaction/amnesia
	// pattern rummy rejects. If t-1 archival doesn't free enough budget,
	// hard 413 strike — the model archives catalog entries to make room.
	async enforce({
		contextSize,
		messages,
		rows,
		lastPromptTokens = 0,
		ctx,
		rummy,
	}) {
		if (!contextSize) {
			return { messages, rows, assembledTokens: 0, ok: true };
		}

		const first = this.#check({
			contextSize,
			messages,
			rows,
			lastPromptTokens,
		});
		if (first.ok) return first;

		const store = rummy.entries;
		const prevTurn = ctx.turn - 1;
		if (prevTurn < 0) {
			await this.#emitOverflow(first.overflow, contextSize, [], ctx, rummy);
			return this.#failed(messages, rows, contextSize, first.overflow);
		}

		const archived = await store.archiveTurnEntries(ctx.runId, prevTurn);
		const archivedWithTurn = archived.map((a) => ({ ...a, turn: prevTurn }));
		if (archived.length === 0) {
			await this.#emitOverflow(first.overflow, contextSize, [], ctx, rummy);
			return this.#failed(messages, rows, contextSize, first.overflow);
		}

		await this.#injectArchiveManifest(prevTurn, archived, ctx, rummy);

		for (const r of rows) {
			if (r.source_turn === prevTurn && r.visibility === "indexed") {
				r.visibility = "archived";
			}
		}
		const reMessages = await this.#reassemble({
			rows,
			ctx,
			rummy,
			contextSize,
			lastPromptTokens: 0,
		});
		const rechecked = this.#check({
			contextSize,
			messages: reMessages,
			rows,
			lastPromptTokens: 0,
		});
		if (rechecked.ok) {
			await this.#emitOverflow(
				first.overflow,
				contextSize,
				archivedWithTurn,
				ctx,
				rummy,
			);
			return rechecked;
		}

		await this.#emitOverflow(
			rechecked.overflow,
			contextSize,
			archivedWithTurn,
			ctx,
			rummy,
		);
		return this.#failed(messages, rows, contextSize, rechecked.overflow);
	}

	// Synthesize a `<get path="log://turn_{prevTurn}/**" manifest/>` log
	// entry naming what the engine just archived. The model reads the
	// archival in its own command grammar — same idiom it would use to
	// list paths itself.
	async #injectArchiveManifest(prevTurn, archived, ctx, rummy) {
		const target = `log://turn_${prevTurn}/**`;
		const lines = archived.map((a) => `${a.path} (${a.tokens})`);
		const body = `MANIFEST get path="${target}": ${archived.length} archived\n${lines.join("\n")}`;
		const path = `log://turn_${ctx.turn}/get/archive_manifest_turn_${prevTurn}`;
		await rummy.entries.set({
			runId: ctx.runId,
			turn: ctx.turn,
			loopId: ctx.loopId,
			path,
			body,
			state: "resolved",
			attributes: {
				path: target,
				manifest: true,
			},
		});
	}

	async #emitOverflow(overflow, contextSize, archived, ctx, rummy) {
		await rummy.hooks.error.log.emit({
			store: rummy.entries,
			runId: ctx.runId,
			turn: ctx.turn,
			loopId: ctx.loopId,
			message: overflowBody(overflow, contextSize, archived),
			status: 413,
			attributes: {
				archivedCount: archived.length,
				archivedTokens: archived.reduce((s, r) => s + r.tokens, 0),
			},
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

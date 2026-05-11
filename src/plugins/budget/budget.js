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

// Manifest format (S8): `* path - tokens` per line.
export function overflowBody(overflow, contextSize, reclaimed) {
	const cap = ceiling(contextSize);
	const size = cap + overflow;
	const count = reclaimed.length;
	const totalTokens = reclaimed.reduce((s, r) => s + r.tokens, 0);
	const head = `Token Budget overflow: packet was ${size} tokens, ceiling is ${cap}. ${count} fat replay${count === 1 ? "" : "s"} (${totalTokens} tokens) reclaimed.`;
	if (count === 0) return head;
	const lines = reclaimed.map((d) => `* ${d.path} - ${d.tokens} tokens`);
	return `${head}\n${lines.join("\n")}`;
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

		// Per-turn meta attrs (formerly on <prompt>): commands, mode warn,
		// archived count from prior turn's grinder fire.
		const activeTools = toolSet
			? new Set(toolSet)
			: new Set(this.#core.hooks.tools.names);
		const commands = this.#core.hooks.tools.advertisedNames
			.filter((n) => activeTools.has(n))
			.join(",");
		const mode = ctx.type;
		let warn = "";
		if (mode === "ask") warn = ' warn="File editing disallowed."';

		let archivedAttr = "";
		const priorTurn = ctx.turn - 1;
		if (priorTurn >= 1) {
			const prior = rows.find((r) => {
				if (r.scheme !== "log") return false;
				if (r.source_turn !== priorTurn) return false;
				if (!r.path?.endsWith("/error")) return false;
				const a =
					typeof r.attributes === "string"
						? JSON.parse(r.attributes)
						: r.attributes;
				return a?.status === 413 && a?.archivedCount > 0;
			});
			if (prior) {
				const a =
					typeof prior.attributes === "string"
						? JSON.parse(prior.attributes)
						: prior.attributes;
				archivedAttr = ` archived="${a.archivedCount}"`;
			}
		}

		const opening = `<turn commands="${commands}"${warn}${archivedAttr} tokenCeiling="${cap}" tokenUsage="${TOKEN_USAGE_PLACEHOLDER}" tokensFree="${TOKENS_FREE_PLACEHOLDER}">`;
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

	// Walk fat replays (get/set log entries from turns < current) by
	// (turn DESC, body_tokens DESC). For each: clear body, status=413.
	// Stop when under budget. Catalog entries are NEVER touched —
	// model owns visibility there. Walking back across turns is fine
	// because fat log bodies are replays of catalog content; 413'ing
	// loses no information (model can re-<get>).
	async enforce({ contextSize, messages, rows, ctx, rummy }) {
		if (!contextSize) {
			return { messages, rows, assembledTokens: 0, ok: true };
		}

		const first = this.#check({ contextSize, messages, rows });
		if (first.ok) return first;

		// Collect fat replay candidates: get/set log entries from turns
		// strictly less than the current turn, with non-empty bodies.
		// log://<L>/<T>/<S>/<action> — terminal segment is the action.
		const candidates = [];
		const logActionRe = /^log:\/\/\d+\/(\d+)\/\d+\/(\w+)$/;
		for (const r of rows) {
			if (r.scheme !== "log") continue;
			const m = logActionRe.exec(r.path);
			if (!m) continue;
			const turn = Number(m[1]);
			const action = m[2];
			if (turn >= ctx.turn) continue;
			if (action !== "get" && action !== "set") continue;
			if (!r.body) continue;
			const tokens = r.aTokens ?? countTokens(r.body);
			if (!tokens) continue;
			candidates.push({ row: r, turn, tokens });
		}
		candidates.sort((a, b) => {
			if (a.turn !== b.turn) return b.turn - a.turn; // turn DESC
			return b.tokens - a.tokens; // size DESC
		});

		const reclaimed = [];
		let remaining = first.overflow;
		for (const c of candidates) {
			if (remaining <= 0) break;
			// loopId propagates so the entry's downstream onFailed
			// cascade (Entries#fireFailed → hooks.error.log.emit →
			// store.logPath) can mint a log path; turns.loop_id is
			// NOT NULL.
			await rummy.entries.set({
				runId: ctx.runId,
				loopId: ctx.loopId,
				turn: ctx.turn,
				path: c.row.path,
				body: "",
				state: "failed",
				outcome: "budget",
			});
			c.row.body = "";
			c.row.state = "failed";
			c.row.outcome = "budget";
			c.row.aTokens = 0;
			c.row.vTokens = 0;
			c.row.vBody = "";
			reclaimed.push({ path: c.row.path, tokens: c.tokens, turn: c.turn });
			remaining = Math.max(0, remaining - c.tokens);
		}

		if (reclaimed.length === 0) {
			await this.#emitOverflow(first.overflow, contextSize, [], ctx, rummy);
			return this.#failed(messages, rows, contextSize, first.overflow);
		}

		const reMessages = await this.#reassemble({
			rows,
			ctx,
			rummy,
			contextSize,
		});
		const rechecked = this.#check({
			contextSize,
			messages: reMessages,
			rows,
		});
		await this.#emitOverflow(
			rechecked.ok ? first.overflow : rechecked.overflow,
			contextSize,
			reclaimed,
			ctx,
			rummy,
		);
		if (rechecked.ok) return rechecked;
		return this.#failed(messages, rows, contextSize, rechecked.overflow);
	}

	async #emitOverflow(overflow, contextSize, reclaimed, ctx, rummy) {
		await rummy.hooks.error.log.emit({
			store: rummy.entries,
			runId: ctx.runId,
			turn: ctx.turn,
			loopId: ctx.loopId,
			message: overflowBody(overflow, contextSize, reclaimed),
			status: 413,
			attributes: {
				archivedCount: reclaimed.length,
				archivedTokens: reclaimed.reduce((s, r) => s + r.tokens, 0),
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

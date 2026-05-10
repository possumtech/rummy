import ContextAssembler from "./ContextAssembler.js";
import { countLines, countTokens } from "./tokens.js";

// Rebuild turn_context from v_model_context and assemble messages.
// Single projection per row — no full/summary split. Archived rows
// are not projected at all.
export default async function materializeContext({
	db,
	hooks,
	runId,
	loopId,
	turn,
	systemPrompt,
	mode,
	toolSet,
	contextSize,
	persona = "",
}) {
	await db.clear_turn_context.run({ run_id: runId, turn });
	const viewRows = await db.get_model_context.all({ run_id: runId });
	const tokenAccounting = new Map();
	for (const row of viewRows) {
		const scheme = row.scheme ? row.scheme : "file";
		const attrs = row.attributes ? JSON.parse(row.attributes) : null;
		// Log entries dispatch to their action plugin's view via path segment.
		let projectionKey = scheme;
		if (scheme === "log") {
			const m = row.path.match(/^log:\/\/turn_\d+\/([^/]+)\//);
			if (m) projectionKey = m[1];
		}
		const baseEntry = {
			path: row.path,
			scheme,
			body: row.body,
			attributes: attrs,
			category: row.category,
		};
		// Archived rows skip projection — they don't appear in any section.
		const projection =
			row.visibility === "archived"
				? ""
				: await hooks.tools.view(projectionKey, baseEntry);
		// Two distinct token counts:
		//   tileTokens = what the projected tile body costs in budget now.
		//   bodyTokens = what the entry's full body costs (what <get> brings).
		// The index tile's JSON meta surfaces bodyTokens so the model knows
		// the cost of fetching. The <turn> budget breakdown sums tileTokens
		// because that's what's actually consuming context this turn.
		const tileTokens = countTokens(projection);
		const tileLines = countLines(projection);
		const bodyTokens = countTokens(row.body);
		const bodyLines = countLines(row.body);
		tokenAccounting.set(row.path, {
			tileTokens,
			tileLines,
			bodyTokens,
			bodyLines,
			body: projection,
		});
		await db.insert_turn_context.run({
			run_id: runId,
			loop_id: loopId,
			turn,
			ordinal: row.ordinal,
			path: row.path,
			visibility: row.visibility,
			state: row.state,
			outcome: row.outcome,
			body: projection,
			attributes: row.attributes,
			category: row.category,
			source_turn: row.turn,
		});
	}
	const rows = await db.get_turn_context.all({ run_id: runId, turn });
	for (const row of rows) {
		const t = tokenAccounting.get(row.path);
		if (!t) continue;
		// vTokens/aTokens = tile cost (what budget sees in packet).
		// bodyTokens/bodyLines = full entry body cost (what <get> brings).
		row.vTokens = t.tileTokens;
		row.aTokens = t.tileTokens;
		row.vLines = t.tileLines;
		row.vBody = t.body;
		row.bodyTokens = t.bodyTokens;
		row.bodyLines = t.bodyLines;
	}
	const lastCtx = await db.get_last_context_tokens.get({ run_id: runId });
	let lastContextTokens = 0;
	if (lastCtx) lastContextTokens = lastCtx.context_tokens;

	const messages = await ContextAssembler.assembleFromTurnContext(
		rows,
		{
			type: mode,
			systemPrompt,
			contextSize,
			toolSet,
			lastContextTokens,
			turn,
			persona,
		},
		hooks,
	);
	return { rows, messages, lastContextTokens };
}

/**
 * Materialize turn_context for a run/turn.
 * Queries v_model_context VIEW and inserts rows directly.
 * No projection functions — for integration tests only.
 *
 * loopId is required (turn_context.loop_id is NOT NULL). Callers
 * pass the loop they want the snapshot scoped to; tests typically
 * use the loop from `seedRun({...}).loopId`.
 */
export default async function materialize(
	db,
	{ runId, loopId, turn, systemPrompt = "test" },
) {
	if (loopId == null) {
		throw new Error("materialize: loopId is required");
	}
	await db.clear_turn_context.run({ run_id: runId, turn });

	if (systemPrompt) {
		await db.insert_turn_context.run({
			run_id: runId,
			loop_id: loopId,
			turn,
			ordinal: 0,
			path: "system://prompt",
			visibility: "indexed",
			state: "resolved",
			body: systemPrompt,
			attributes: null,
			category: "system",
		});
	}

	const rows = await db.get_model_context.all({ run_id: runId });
	for (const row of rows) {
		await db.insert_turn_context.run({
			run_id: runId,
			loop_id: loopId,
			turn,
			ordinal: row.ordinal,
			path: row.path,
			visibility: row.visibility,
			state: row.state,
			outcome: row.outcome,
			body: row.body,
			attributes: row.attributes,
			category: row.category,
			source_turn: row.turn,
		});
	}
}

export default class ContextPlugin {
	static register(hooks) {
		hooks.onTurn(async (rummy) => {
			const { db } = rummy;
			if (!rummy.runId) return;

			const pending = await db.get_pending_context.all({
				run_id: rummy.runId,
			});
			if (pending.length === 0) return;

			for (const row of pending) {
				const attrs = { command: row.request, type: row.type };
				if (row.is_error) attrs.error = "true";
				const infoEl = rummy.tag("info", attrs, [row.result]);
				rummy.contextEl.appendChild(infoEl);

				if (rummy.turnId) {
					await db.consume_pending_context.run({
						id: row.id,
						turn_id: rummy.turnId,
					});
				}
			}
		}, 5);
	}
}

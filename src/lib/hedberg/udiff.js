// Two siblings of the same edit, kept conceptually distinct:
//
//   udiff      — full createTwoFilesPatch banner; what clients
//                (rummy.nvim, web UI) parse. `renderClient`.
//   udifflite  — hunks only, no header, context: 0; what the model
//                READS in <log> set bodies. `renderModel`.
//
// Model emissions write through heredoc operations (see
// `marker.js:parseHeredocOps`). The udiff family is render-only —
// the engine emits these forms to clients and to the model's log
// view, never parses them back from model input.

import { createTwoFilesPatch, structuredPatch } from "diff";

// ---------- udiff: engine → client ----------

export function renderClient(entryPath, oldContent, newContent) {
	return createTwoFilesPatch(
		`${entryPath}\told`,
		`${entryPath}\tnew`,
		oldContent,
		newContent,
		"",
		"",
		{ context: 3 },
	);
}

// ---------- udifflite: engine → model ----------

export function renderModel(oldContent, newContent) {
	const before = oldContent == null ? "" : oldContent;
	const after = newContent == null ? "" : newContent;
	if (before === after) return "";
	const { hunks } = structuredPatch("a", "b", before, after, "", "", {
		context: 0,
	});
	const blocks = hunks.map((h) => {
		const header = `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`;
		// Filter the `\ No newline at end of file` metadata marker — it's
		// information for human readers, noise for the model. Match the
		// exact `\ ` (backslash-space) shape only.
		const lines = h.lines.filter((l) => !l.startsWith("\\ "));
		return [header, ...lines].join("\n");
	});
	return blocks.join("\n");
}

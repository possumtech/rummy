// Three siblings of the same edit, kept conceptually distinct:
//
//   udiff      — full createTwoFilesPatch banner; what clients
//                (rummy.nvim, web UI) parse. `renderClient`.
//   udifflite  — hunks only, no header, context: 0; what the model
//                READS in <log> set bodies. `renderModel`.
//   udiffberg  — fuzzy-tolerant parse of what the model WRITES in
//                <set> bodies. Line numbers are hints, content is the
//                anchor; Hedberg's literal+fuzzy rescue per hunk.
//                `parseModel` + `applyModel`.
//
// Same bytes can look alike; the contracts are not. Drift between
// the three is how this breaks — keep them at one site.

import { createTwoFilesPatch, structuredPatch } from "diff";
import Hedberg from "./hedberg.js";

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

// ---------- udiffberg: model → engine ----------

const HUNK_HEADER_RE = /^@@\s*-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s*@@/;

// Returns one of:
//   { hunks: Hunk[] }     — body starts with `@@`, one or more hunks parsed
//   { body: string }       — body has no `@@` header → raw NEW content
//   { error: string }      — malformed hunk grammar
export function parseModel(text) {
	if (text == null || text === "") return { body: "" };
	if (!text.trimStart().startsWith("@@")) {
		return { body: text };
	}

	const hunks = [];
	const lines = text.split("\n");
	let current = null;
	let sawHeader = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.startsWith("@@")) {
			const m = line.match(HUNK_HEADER_RE);
			if (!m) {
				return { error: `bad hunk header: ${line}` };
			}
			if (current) hunks.push(current);
			current = {
				oldStart: Number(m[1]),
				oldLines: m[2] != null ? Number(m[2]) : 1,
				newStart: Number(m[3]),
				newLines: m[4] != null ? Number(m[4]) : 1,
				lines: [],
			};
			sawHeader = true;
			continue;
		}
		// `\ No newline at end of file` is udiff metadata — drop it.
		// Narrow: only the canonical `\ ` (backslash-space) marker; do
		// not eat `\+`/`\-`/`\ ` (without space) content escapes that
		// models sometimes emit.
		if (line.startsWith("\\ ")) continue;
		if (current) {
			current.lines.push(line);
		} else if (sawHeader || line.trim() !== "") {
			// Content before any @@ when the body looked like udiff:
			// malformed.
			return { error: `non-hunk content before @@ header: ${line}` };
		}
	}
	if (current) hunks.push(current);
	if (hunks.length === 0) {
		return { error: "leading @@ but no parseable hunks" };
	}
	return { hunks };
}

// Apply parsed hunks against current body. Strict-first (use the @@
// line refs at face value), Hedberg fallback (literal+fuzzy+indent-
// heal) when strict misses. Returns the same shape set.js's existing
// conflict-reporting expects.
export function applyModel(body, hunks) {
	let working = body == null ? "" : body;
	const opPositions = [];
	const warnings = [];

	for (const hunk of hunks) {
		const { search, replace } = splitHunkLines(hunk.lines);

		// Hunk arrived with lines but split produced nothing → every
		// line was filtered (e.g., all-metadata, or a parser failure).
		// Raise loudly rather than silently skip; otherwise the model
		// thinks its edit landed while the entry is still empty.
		if (hunk.lines.length > 0 && search.length === 0 && replace.length === 0) {
			return {
				error: "udiff hunk had lines but none parsed as -/+/ context",
				attempted: hunk.lines.join("\n"),
				currentBody: working,
				opPositions,
				warning: warnings.length ? warnings.join(" ") : null,
			};
		}

		// Pure insert: no `-` lines. Anchor on `@@` oldStart and just
		// drop the `+` lines in. Empty hunk (no lines at all) is a
		// legitimate degenerate case (e.g. zero-line file marker).
		if (search.length === 0) {
			if (replace.length === 0) continue;
			const inserted = insertAtLine(working, hunk.oldStart, replace);
			working = inserted.newBody;
			opPositions.push({
				kind:
					replace.length > 0 && working.length === replace.join("\n").length
						? "new"
						: "insert",
				startLine: inserted.position,
				lineCount: replace.length,
				content: replace.join("\n"),
			});
			continue;
		}

		// Strict apply: do the `-` lines literally appear at `oldStart`?
		// Cheap precision when the model got coords right.
		const strict = tryStrictApply(working, hunk.oldStart, search, replace);
		if (strict.ok) {
			working = strict.newBody;
			opPositions.push({
				kind: replace.length === 0 ? "delete" : "search_replace",
				startLine: hunk.oldStart,
				lineCount: replace.length,
				content: replace.join("\n"),
			});
			continue;
		}

		// Hedberg fallback: literal line-bounded match → fuzzy tokenized
		// match → indent-healing. Same rescue path the HEREDOC grammar
		// used; udiff just carries an extra line-number hint we ignored
		// after strict failed.
		const fuzzy = Hedberg.replace(
			working,
			search.join("\n"),
			replace.join("\n"),
		);
		if (fuzzy.error) {
			return {
				error: fuzzy.error,
				attempted: search.join("\n"),
				currentBody: working,
				opPositions,
				warning: warnings.length ? warnings.join(" ") : null,
			};
		}
		working = fuzzy.patch;
		if (fuzzy.warning) warnings.push(fuzzy.warning);
		opPositions.push({
			kind: replace.length === 0 ? "delete" : "search_replace",
			startLine: fuzzy.matchStartLine ?? hunk.oldStart,
			lineCount: replace.length,
			content: replace.join("\n"),
		});
	}

	return {
		newBody: working,
		opPositions,
		warning: warnings.length ? warnings.join(" ") : null,
		error: null,
	};
}

function splitHunkLines(hunkLines) {
	const search = [];
	const replace = [];
	for (const raw of hunkLines) {
		// Drop the canonical udiff metadata marker only.
		if (raw.startsWith("\\ ")) continue;
		// Trailing/blank lines (e.g. the newline right before `</set>`)
		// carry no edit content. Pushing "" as bare context drives the
		// strict miss → Hedberg fallback path with an empty needle,
		// which loops forever inside HeuristicMatcher's exact-match.
		if (raw === "") continue;
		// Models sometimes emit `\+`, `\-`, `\ ` (escape carryover from
		// markdown-flavored udiff in training). Strip a single stray
		// leading backslash before a valid prefix — the intent is
		// unambiguously the underlying prefix.
		const line = /^\\[-+ ]/.test(raw) ? raw.slice(1) : raw;
		const prefix = line[0];
		const text = line.slice(1);
		if (prefix === "-") {
			search.push(text);
		} else if (prefix === "+") {
			replace.push(text);
		} else if (prefix === " ") {
			search.push(text);
			replace.push(text);
		} else {
			// Bare line (no prefix). Treat as context — safest for fuzzy
			// rescue. Strict apply will likely miss; that's fine.
			search.push(line);
			replace.push(line);
		}
	}
	return { search, replace };
}

function tryStrictApply(body, oldStart, searchLines, replaceLines) {
	const bodyLines = body === "" ? [] : body.split("\n");
	const startIdx = Math.max(0, oldStart - 1);
	if (startIdx + searchLines.length > bodyLines.length) return { ok: false };
	for (let i = 0; i < searchLines.length; i++) {
		if (bodyLines[startIdx + i] !== searchLines[i]) return { ok: false };
	}
	const newBodyLines = [
		...bodyLines.slice(0, startIdx),
		...replaceLines,
		...bodyLines.slice(startIdx + searchLines.length),
	];
	return { ok: true, newBody: newBodyLines.join("\n") };
}

function insertAtLine(body, lineNumber, replaceLines) {
	const bodyLines = body === "" ? [] : body.split("\n");
	// udiff pure-insert convention: `@@ -X,0 +X+1,N @@` inserts AFTER
	// line X (or at the start for X=0). idx is the array index where
	// the new lines slot in.
	const idx = Math.max(0, Math.min(lineNumber, bodyLines.length));
	const newBodyLines = [
		...bodyLines.slice(0, idx),
		...replaceLines,
		...bodyLines.slice(idx),
	];
	return {
		newBody: newBodyLines.join("\n"),
		position: idx + 1,
	};
}

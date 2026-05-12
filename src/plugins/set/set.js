import Entries from "../../agent/Entries.js";
import { countTokens } from "../../agent/tokens.js";
import Hedberg, { generatePatch } from "../../lib/hedberg/hedberg.js";
import { generateBodyUdiff } from "../../lib/hedberg/matcher.js";
import File from "../file/file.js";
import { storePatternResult } from "../helpers.js";
import docs from "./setDoc.js";

const LOG_ACTION_RE = /^log:\/\/\d+\/\d+\/\d+\/(\w+)$/;

// <set archive>/<set index> are boolean attrs. Both → conflict.
// Returns "archived" | "indexed" | null (no flip), or "conflict".
function visibilityFromAttrs(attrs) {
	const wantArchive = attrs.archive !== undefined;
	const wantIndex = attrs.index !== undefined;
	if (wantArchive && wantIndex) return "conflict";
	if (wantArchive) return "archived";
	if (wantIndex) return "indexed";
	return null;
}

function isSetProposal(path) {
	const m = LOG_ACTION_RE.exec(path);
	return m?.[1] === "set";
}

const CONFLICT_FEEDBACK_MAX_CHARS = 4000;
function truncateForFeedback(body) {
	if (body == null) return null;
	if (body.length <= CONFLICT_FEEDBACK_MAX_CHARS) return body;
	const head = body.slice(0, CONFLICT_FEEDBACK_MAX_CHARS);
	return `${head}\n[truncated; ${body.length - CONFLICT_FEEDBACK_MAX_CHARS} more chars — <get> the path for full body]`;
}

// biome-ignore lint/suspicious/noShadowRestrictedNames: tool name is "set"
export default class Set {
	#core;

	constructor(core) {
		this.#core = core;
		core.registerScheme();
		core.on("handler", this.handler.bind(this));
		core.on("view", this.full.bind(this));
		core.filter("instructions.toolDocs", async (docsMap) => {
			docsMap.set = docs;
			return docsMap;
		});
		core.filter("proposal.accepting", this.#vetoReadonly.bind(this));
		core.filter("proposal.content", this.#preferExistingBody.bind(this));
		// Shape-coupled (attrs.path + attrs.patched) — cp/set share one materializer.
		core.on("proposal.accepted", this.#materializeFile.bind(this));
	}

	async #vetoReadonly(current, ctx) {
		if (current) return current;
		if (!isSetProposal(ctx.path)) return current;
		if (!ctx.attrs?.path) return current;
		const blocked = await File.isReadonly(
			ctx.db,
			ctx.projectId,
			ctx.attrs.path,
		);
		if (!blocked) return current;
		return {
			allow: false,
			outcome: "readonly",
			body: `refused: ${ctx.attrs.path} is readonly`,
		};
	}

	async #preferExistingBody(defaultBody, ctx) {
		if (!isSetProposal(ctx.path)) return defaultBody;
		const existing = await ctx.entries.getBody(ctx.runId, ctx.path);
		if (existing) return existing;
		return defaultBody;
	}

	async #materializeFile(ctx) {
		const { attrs, runId, projectId, projectRoot, db, entries, loopId, turn } =
			ctx;
		if (!attrs?.path || attrs?.patched == null) return;

		const existing = await entries.getBody(runId, attrs.path);
		const isNewFile = existing === null;
		const patched = attrs.patched;
		// Visibility precedence: explicit attr > existing state > scheme default.
		// Visibility precedence: archive/index booleans → attrs.visibility
		// (set by upstream cp/mv which already resolved the model's
		// archive/index attrs into a string) → existing entry's state.
		const explicit = visibilityFromAttrs(attrs);
		const existingState = await entries.getState(runId, attrs.path);
		const visibility =
			explicit && explicit !== "conflict"
				? explicit
				: attrs.visibility || existingState?.visibility;
		await entries.set({
			runId,
			loopId,
			turn,
			path: attrs.path,
			body: patched,
			visibility,
		});
		if (projectRoot) {
			const { writeFile, mkdir } = await import("node:fs/promises");
			const { dirname, isAbsolute, join } = await import("node:path");
			const targetPath = isAbsolute(attrs.path)
				? attrs.path
				: join(projectRoot, attrs.path);
			await mkdir(dirname(targetPath), { recursive: true });
			await writeFile(targetPath, patched);
		}
		if (isNewFile && projectId) {
			await File.setConstraint(db, projectId, attrs.path, "add");
		}
	}

	async handler(entry, rummy) {
		const { entries: store, sequence: turn, runId, loopId } = rummy;
		const attrs = entry.attributes;
		const visibilityAttr = visibilityFromAttrs(attrs);
		const rawTags = typeof attrs.tags === "string" ? attrs.tags : null;
		const tagsText = rawTags ? rawTags.slice(0, 80) : null;

		// log:// is immutable; visibility flips OK, body rewrites are not.
		if (attrs.path?.startsWith("log://") && entry.body) {
			await store.set({
				runId,
				turn,
				loopId,
				path: entry.resultPath,
				body: `log:// is immutable. To archive: <set path="${attrs.path}" archive/> (no body).`,
				state: "failed",
				outcome: "method_not_allowed",
				attributes: { path: attrs.path },
			});
			return;
		}

		// Handler-entry permission gate. The model's `<set>` emission is
		// always model-attributed; if the target scheme isn't model-
		// writable (unknown scheme, or registered plugin-only like
		// repo://), throw before any branch runs. Dispatch turns
		// PermissionError into error.log → strike.
		if (attrs.path && !attrs.path.startsWith("log://")) {
			await store.assertWritable(attrs.path, "model");
		}

		// Both archive + index → conflict; surface as validation failure.
		if (visibilityAttr === "conflict") {
			await store.set({
				runId,
				turn,
				loopId,
				path: entry.resultPath,
				body: "Cannot specify both archive and index on the same <set>.",
				state: "failed",
				outcome: "validation",
				attributes: { path: attrs.path },
			});
			return;
		}

		if (attrs.error) {
			await store.set({
				runId,
				turn,
				loopId,
				path: entry.resultPath,
				body: attrs.error,
				state: "failed",
				outcome: "validation",
				attributes: { path: attrs.path, error: attrs.error },
			});
			return;
		}

		// Manifest: universal preview gate, fires before any operational branch.
		if (attrs.manifest !== undefined && attrs.path) {
			const matches = await store.getEntriesByPattern(
				runId,
				attrs.path,
				attrs.body,
			);
			await storePatternResult(
				store,
				runId,
				turn,
				"set",
				attrs.path,
				attrs.body,
				matches,
				{ manifest: true, loopId, attributes: { path: attrs.path } },
			);
			return;
		}

		// Pure visibility/metadata change — no body content AND no
		// edit operations. `<set path="X" index><<NEW…NEW</set>` parses
		// the inner content into `attrs.operations`, leaving
		// `entry.body` empty; if we routed that through the visibility-
		// flip branch we'd silently drop the model's write. Visibility
		// flip is what falls through to the edit branch below — apply
		// content first, then visibility lands on the resulting entry.
		if (!entry.body && !attrs.operations && visibilityAttr && attrs.path) {
			const target = attrs.path;
			const matches = await store.getEntriesByPattern(
				runId,
				target,
				attrs.body,
			);
			if (matches.length === 0) {
				await store.set({
					runId,
					turn,
					path: entry.resultPath,
					body: `${target} not found`,
					state: "failed",
					outcome: "not_found",
					visibility: "archived",
					loopId,
					attributes: { path: target },
				});
				return;
			}
			for (const match of matches) {
				await store.set({
					runId: runId,
					path: match.path,
					visibility: visibilityAttr,
				});
				if (tagsText) {
					await store.set({
						runId: runId,
						path: match.path,
						attributes: {
							tags: tagsText,
						},
					});
				}
			}
			const label = `set to ${visibilityAttr}`;
			await store.set({
				runId,
				turn,
				path: entry.resultPath,
				body: `${matches.map((m) => m.path).join(", ")} ${label}`,
				state: "resolved",
				visibility: "archived",
				loopId,
				// Target identity on the log envelope so downstream
				// readers (digest, materialization) can attribute the
				// recap without parsing the body prose.
				attributes: { path: target },
			});
			return;
		}

		const target = attrs.path;
		if (!target) return;
		let newContent;
		let opPositions = null;
		if (attrs.operations) {
			const existing = await store.getBody(runId, target);
			// Missing-path recovery: search_replace → append (replace text only),
			// delete → drop. Lets the model's edit-shaped emission land on a
			// fresh path without first having to write a NEW.
			const operations =
				existing === null
					? attrs.operations.flatMap((op) => {
							if (op.op === "search_replace") {
								return [{ op: "append", content: op.replace }];
							}
							if (op.op === "delete") return [];
							return [op];
						})
					: attrs.operations;
			if (operations.length === 0) return;
			const result = Set.#applyOperations(
				existing == null ? "" : existing,
				operations,
			);
			if (result.error) {
				await store.set({
					runId,
					turn,
					loopId,
					path: entry.resultPath,
					body: existing == null ? "" : existing,
					state: "failed",
					outcome: "conflict",
					attributes: {
						path: target,
						error: result.error,
						attempted: result.attempted,
						// Scoped ops carry just the lines at the failed range
						// (already small, targeted feedback). Unscoped ops
						// fall back to the truncated whole body.
						currentBody:
							result.currentBody != null
								? result.currentBody
								: truncateForFeedback(existing),
					},
				});
				return;
			}
			newContent = result.body;
			opPositions = result.opPositions;
		} else if (entry.body) {
			newContent = entry.body;
		}

		// `op` envelope attribute: comma-separated list of operative
		// label kinds from the model's emission. Surfaces the operative
		// intent at zero body cost — the body projection strips SEARCH
		// halves (and the operative labels themselves) for budget
		// reasons; the envelope JSON carries the intent forward so the
		// model's future-self reading the log knows what kind of edit
		// happened without inferring from numbered-line shape alone.
		// Derived from `attrs.operations` (parser output) so DELETE ops
		// — which contribute no renderable body — are still surfaced.
		const opField = attrs.operations
			? attrs.operations.map((o) => o.op).join(",")
			: null;

		if (newContent !== undefined) {
			const scheme = Entries.scheme(target);
			if (scheme === null) {
				// File write: proposed entry; #materializeFile writes to disk on accept.
				// Log body = trimmed udiff (model-facing, training-friendly).
				// attrs.patch = full createTwoFilesPatch udiff with header —
				// rummy.nvim and other client renderers read this (wire
				// contract pinned by proposal_wire_contract.test.js).
				// attrs.patched = full new content (materializer reads on accept).
				const existing = await store.getBody(runId, target);
				const oldContent = existing == null ? "" : existing;
				const udiff = generatePatch(target, oldContent, newContent);
				const bodyUdiff = generateBodyUdiff(oldContent, newContent);
				const beforeTokens = oldContent ? countTokens(oldContent) : 0;
				const afterTokens = countTokens(newContent);
				await store.set({
					runId,
					turn,
					path: entry.resultPath,
					body: bodyUdiff,
					state: "proposed",
					attributes: {
						path: target,
						patch: udiff,
						patched: newContent,
						beforeActionTokens: beforeTokens,
						afterActionTokens: afterTokens,
						tags: tagsText,
						...(opField ? { op: opField } : {}),
						...(opPositions ? { opPositions } : {}),
						...(visibilityAttr && visibilityAttr !== "conflict"
							? { [visibilityAttr === "indexed" ? "index" : "archive"]: true }
							: {}),
					},
					loopId,
				});
			} else if (attrs.filter || target.includes("*")) {
				// Pattern body-update: bulk body assignment, no operations.
				const matches = await store.getEntriesByPattern(
					runId,
					target,
					attrs.filter,
				);
				await store.set({
					runId: runId,
					path: target,
					body: newContent,
					bodyFilter: attrs.filter === undefined ? null : attrs.filter,
				});
				await storePatternResult(
					store,
					runId,
					turn,
					"set",
					target,
					attrs.filter,
					matches,
					{ loopId },
				);
			} else {
				// Scheme write (known://, unknown://, etc.): the underlying
				// entry resolves directly. Log body = trimmed udiff
				// (model-facing). attrs.patch = full udiff for client
				// renderers.
				const existing = await store.getBody(runId, target);
				const oldContent = existing == null ? "" : existing;
				const udiff = generatePatch(target, oldContent, newContent);
				const bodyUdiff = generateBodyUdiff(oldContent, newContent);
				const beforeTokens = oldContent ? countTokens(oldContent) : 0;
				const afterTokens = countTokens(newContent);

				await store.set({
					runId,
					turn,
					path: target,
					body: newContent,
					state: "resolved",
					visibility: visibilityAttr ? visibilityAttr : "indexed",
					attributes: tagsText ? { tags: tagsText } : null,
					loopId,
				});
				await store.set({
					runId,
					turn,
					path: entry.resultPath,
					body: bodyUdiff,
					state: "resolved",
					loopId,
					attributes: {
						path: target,
						patch: udiff,
						beforeActionTokens: beforeTokens,
						afterActionTokens: afterTokens,
						tags: tagsText,
						...(opField ? { op: opField } : {}),
						...(opPositions ? { opPositions } : {}),
					},
				});
			}
		}

		if (visibilityAttr && attrs.path) {
			const target = attrs.path;
			const scheme = Entries.scheme(target);
			if (scheme !== null) {
				await store.set({
					runId: runId,
					path: target,
					visibility: visibilityAttr,
				});
			}
			if (tagsText) {
				await store.set({
					runId: runId,
					path: target,
					attributes: { tags: tagsText },
				});
			}
		}
	}

	full(entry) {
		const attrs = entry.attributes;
		if (attrs.error) {
			const target = attrs.path || entry.path;
			const lines = [`error at ${target}: ${attrs.error}`];
			if (attrs.attempted) {
				lines.push("", "--- attempted ---", attrs.attempted);
			}
			if (attrs.currentBody != null) {
				lines.push("", `--- current body of ${target} ---`, attrs.currentBody);
			}
			return lines.join("\n");
		}
		return entry.body;
	}

	static #applyOperations(currentBody, operations) {
		let body = currentBody;
		// Per-op tracking in *final body* coords. Each completed op records
		// where its new content lives; subsequent ops shift prior records.
		// Delete ops record nothing (no content to project).
		const tracked = [];
		const shiftAfter = (afterLine, delta) => {
			for (const t of tracked) {
				if (t.startLine >= afterLine) {
					t.startLine += delta;
				}
			}
		};
		const invalidateRange = (start, end) => {
			for (let i = tracked.length - 1; i >= 0; i--) {
				const t = tracked[i];
				const tEnd = t.startLine + t.lineCount - 1;
				if (t.startLine >= start && tEnd <= end) tracked.splice(i, 1);
			}
		};
		const countLines = (s) => (s === "" ? 0 : s.split("\n").length);

		for (const op of operations) {
			if (op.op === "new" || op.op === "replace") {
				body = op.content;
				tracked.length = 0;
				const lc = countLines(op.content);
				if (lc > 0)
					tracked.push({
						kind: op.op,
						startLine: 1,
						lineCount: lc,
						content: op.content,
					});
			} else if (op.op === "append") {
				const preLines = countLines(body);
				body = body + op.content;
				const lc = countLines(op.content);
				if (lc > 0)
					tracked.push({
						kind: "append",
						startLine: preLines + 1,
						lineCount: lc,
						content: op.content,
					});
			} else if (op.op === "prepend") {
				const lc = countLines(op.content);
				shiftAfter(1, lc);
				body = op.content + body;
				if (lc > 0)
					tracked.push({
						kind: "prepend",
						startLine: 1,
						lineCount: lc,
						content: op.content,
					});
			} else if (op.op === "delete") {
				const result = Hedberg.replace(body, op.content, "");
				if (result.error) {
					return {
						body,
						error: result.error,
						attempted: op.content,
						opPositions: tracked,
					};
				}
				const matchStart = result.matchStartLine;
				const removed = result.searchLineCount;
				if (matchStart != null && removed > 0) {
					invalidateRange(matchStart, matchStart + removed - 1);
					shiftAfter(matchStart + removed, -removed);
				}
				body = result.patch;
			} else if (op.op === "search_replace") {
				if (op.scope) {
					const result = Set.#applyScopedReplace(body, op);
					if (result.error) {
						return {
							body,
							error: result.error,
							attempted: result.attempted,
							currentBody: result.currentBody,
							opPositions: tracked,
						};
					}
					const { start, end } = op.scope;
					const oldLines = end - start + 1;
					const newLines = countLines(op.replace);
					invalidateRange(start, end);
					shiftAfter(end + 1, newLines - oldLines);
					body = result.body;
					if (newLines > 0)
						tracked.push({
							kind: "search_replace",
							startLine: start,
							lineCount: newLines,
							content: op.replace,
						});
				} else {
					const result = Hedberg.replace(body, op.search, op.replace);
					if (result.error) {
						return {
							body,
							error: result.error,
							attempted: op.search,
							opPositions: tracked,
						};
					}
					const matchStart = result.matchStartLine;
					const oldLines = result.searchLineCount;
					const newLines = result.replaceLineCount;
					if (matchStart != null) {
						invalidateRange(matchStart, matchStart + oldLines - 1);
						shiftAfter(matchStart + oldLines, newLines - oldLines);
						if (newLines > 0)
							tracked.push({
								kind: "search_replace",
								startLine: matchStart,
								lineCount: newLines,
								content: op.replace,
							});
					}
					body = result.patch;
				}
			}
		}
		tracked.sort((a, b) => a.startLine - b.startLine);
		return { body, error: null, attempted: null, opPositions: tracked };
	}

	// Scoped SEARCH/REPLACE: `<<SEARCH[X]…SEARCH[Y]<<REPLACE…REPLACE`.
	// Lines N..M (1-indexed, inclusive) of `body` are replaced by `op.replace`.
	// If `op.search` is non-empty, it must exactly match the current text at
	// that range (content verification on top of the positional scope). An
	// empty `op.search` is the trust-the-numbers form — undocumented but
	// supported. Out-of-range or content-mismatch produces a `conflict` so
	// the model gets the actual range body back as feedback.
	static #applyScopedReplace(body, op) {
		const { start, end } = op.scope;
		const lines = body.split("\n");
		if (start < 1 || end < start || end > lines.length) {
			return {
				error: `SEARCH[${start}${start === end ? "" : `-${end}`}] is out of range; current body has ${lines.length} line${lines.length === 1 ? "" : "s"}.`,
				attempted: op.replace,
				currentBody: body,
			};
		}
		const actual = lines.slice(start - 1, end).join("\n");
		if (op.search !== "" && op.search !== actual) {
			return {
				error: `SEARCH[${start}${start === end ? "" : `-${end}`}] content does not match the current lines at that range.`,
				attempted: op.search,
				currentBody: actual,
			};
		}
		const replaceLines = op.replace === "" ? [] : op.replace.split("\n");
		const next = [
			...lines.slice(0, start - 1),
			...replaceLines,
			...lines.slice(end),
		];
		return { body: next.join("\n") };
	}
}

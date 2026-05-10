import Entries from "../../agent/Entries.js";
import { countTokens } from "../../agent/tokens.js";
import Hedberg, { generatePatch } from "../../lib/hedberg/hedberg.js";
import File from "../file/file.js";
import { projectEmission, storePatternResult } from "../helpers.js";
import docs from "./setDoc.js";

const LOG_ACTION_RE = /^log:\/\/turn_\d+\/(\w+)\//;

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
		const { attrs, runId, projectId, projectRoot, db, entries } = ctx;
		if (!attrs?.path || attrs?.patched == null) return;

		const existing = await entries.getBody(runId, attrs.path);
		const isNewFile = existing === null;
		const patched = attrs.patched;
		const turn = (await db.get_run_by_id.get({ id: runId })).next_turn;
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

		// Pure visibility/metadata change — no body content
		if (!entry.body && visibilityAttr && attrs.path) {
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
			});
			return;
		}

		const target = attrs.path;
		if (!target) return;
		let newContent;
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
						currentBody: truncateForFeedback(existing),
					},
				});
				return;
			}
			newContent = result.body;
		} else if (entry.body) {
			newContent = entry.body;
		}

		if (newContent !== undefined) {
			const scheme = Entries.scheme(target);
			if (scheme === null) {
				// File write: proposed entry; #materializeFile writes to disk on accept.
				const existing = await store.getBody(runId, target);
				const oldContent = existing == null ? "" : existing;
				const udiff = generatePatch(target, oldContent, newContent);
				const beforeTokens = oldContent ? countTokens(oldContent) : 0;
				const afterTokens = countTokens(newContent);
				await store.set({
					runId,
					turn,
					path: entry.resultPath,
					body: attrs.inner,
					state: "proposed",
					attributes: {
						path: target,
						patch: udiff,
						patched: newContent,
						beforeActionTokens: beforeTokens,
						afterActionTokens: afterTokens,
						tags: tagsText,
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
				const existing = await store.getBody(runId, target);
				const oldContent = existing == null ? "" : existing;
				const udiff = generatePatch(target, oldContent, newContent);
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
					body: attrs.inner,
					state: "resolved",
					loopId,
					attributes: {
						path: target,
						patch: udiff,
						beforeActionTokens: beforeTokens,
						afterActionTokens: afterTokens,
						tags: tagsText,
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
			return projectEmission(lines.join("\n"));
		}
		return projectEmission(entry.body);
	}

	static #applyOperations(currentBody, operations) {
		let body = currentBody;
		for (const op of operations) {
			if (op.op === "new" || op.op === "replace") {
				body = op.content;
			} else if (op.op === "append") {
				body = body + op.content;
			} else if (op.op === "prepend") {
				body = op.content + body;
			} else if (op.op === "delete") {
				const result = Hedberg.replace(body, op.content, "");
				if (result.error) {
					return { body, error: result.error, attempted: op.content };
				}
				body = result.patch;
			} else if (op.op === "search_replace") {
				const result = Hedberg.replace(body, op.search, op.replace);
				if (result.error) {
					return { body, error: result.error, attempted: op.search };
				}
				body = result.patch;
			}
		}
		return { body, error: null, attempted: null };
	}
}

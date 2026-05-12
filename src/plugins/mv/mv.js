import Entries from "../../agent/Entries.js";
import { countLines, countTokens } from "../../agent/tokens.js";
import { generatePatch } from "../../lib/hedberg/matcher.js";
import { storePatternResult } from "../helpers.js";
import docs from "./mvDoc.js";

const LOG_ACTION_RE = /^log:\/\/\d+\/\d+\/\d+\/(\w+)$/;

function visibilityFromAttrs(attrs) {
	const wantArchive = attrs.archive !== undefined;
	const wantIndex = attrs.index !== undefined;
	if (wantArchive && wantIndex) return "conflict";
	if (wantArchive) return "archived";
	if (wantIndex) return "indexed";
	return undefined;
}

export default class Mv {
	#core;

	constructor(core) {
		this.#core = core;
		core.registerScheme();
		core.on("handler", this.handler.bind(this));
		core.on("view", this.full.bind(this));
		core.filter("instructions.toolDocs", async (docsMap) => {
			docsMap.mv = docs;
			return docsMap;
		});
		core.on("proposal.accepted", this.#onAccepted.bind(this));
	}

	// mv source removal: atomic on set acceptance. The user's single
	// accept on the destination set proposal IS the move agreement;
	// no second prompt for cleanup. Linkage: mv's resolved recap (at
	// log://.../mv) carries `attrs.setProposal` = path of the spawned
	// set proposal. On any proposal.accepted, mv scans for a recap
	// whose setProposal matches the accepted path; if found, perform
	// the source removal (entries.rm + filesystem unlink for bare
	// sources) and emit a resolved /rm log entry for audit.
	async #onAccepted(ctx) {
		const acceptedPath = ctx.path;
		const setMatch = LOG_ACTION_RE.exec(acceptedPath);
		if (setMatch?.[1] !== "set") return;
		const recaps = await ctx.entries.getEntriesByPattern(ctx.runId, "log://*");
		const recap = recaps.find((r) => {
			if (LOG_ACTION_RE.exec(r.path)?.[1] !== "mv") return false;
			const attrs =
				typeof r.attributes === "string"
					? JSON.parse(r.attributes)
					: r.attributes;
			return attrs?.setProposal === acceptedPath;
		});
		if (!recap) return;
		const recapAttrs =
			typeof recap.attributes === "string"
				? JSON.parse(recap.attributes)
				: recap.attributes;
		const source = recapAttrs.from;
		if (!source) return;
		await ctx.entries.rm({ runId: ctx.runId, path: source });
		// Bare-path source: unlink from filesystem too. Schemed sources
		// (known://, etc.) are scratchpad-only — entries.rm is the
		// whole cleanup.
		if (ctx.projectRoot && !source.includes("://")) {
			const { unlink } = await import("node:fs/promises");
			const { isAbsolute, join } = await import("node:path");
			const targetPath = isAbsolute(source)
				? source
				: join(ctx.projectRoot, source);
			try {
				await unlink(targetPath);
			} catch (err) {
				// File may already be absent — entry rm'd regardless.
				if (err.code !== "ENOENT") throw err;
			}
		}
		// Audit: resolved /rm log entry so the model sees both halves
		// of the mv complete in <log>.
		const rmPath = await ctx.entries.logPath(
			ctx.runId,
			ctx.loopId,
			ctx.turn,
			"rm",
		);
		await ctx.entries.set({
			runId: ctx.runId,
			loopId: ctx.loopId,
			turn: ctx.turn,
			path: rmPath,
			body: `removed ${source} (mv source)`,
			state: "resolved",
			attributes: { path: source, mv: recap.path },
		});
	}

	async handler(entry, rummy) {
		const { entries: store, sequence: turn, runId, loopId } = rummy;
		const { path, to } = entry.attributes;
		const visibilityAttr = visibilityFromAttrs(entry.attributes);
		if (visibilityAttr === "conflict") {
			await store.set({
				runId,
				turn,
				loopId,
				path: entry.resultPath,
				body: "Cannot specify both archive and index on the same <mv>.",
				state: "failed",
				outcome: "validation",
				attributes: { path, to },
			});
			return;
		}
		const visibility = visibilityAttr;

		if (entry.attributes.manifest !== undefined) {
			const matches = await store.getEntriesByPattern(runId, path);
			await storePatternResult(store, runId, turn, "mv", path, null, matches, {
				manifest: true,
				loopId,
				attributes: { path, to },
			});
			return;
		}

		// Visibility-in-place: no destination, change visibility of matches.
		if (visibility && !to) {
			const matches = await store.getEntriesByPattern(runId, path);
			for (const match of matches)
				await store.set({
					runId: runId,
					path: match.path,
					visibility: visibility,
				});
			const label = `set to ${visibility}`;
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

		const source = await store.getBody(runId, path);
		if (source === null) return;
		// Tags: explicit attr wins; otherwise destination inherits source's.
		let destTags = null;
		if (typeof entry.attributes.tags === "string") {
			destTags = entry.attributes.tags;
		} else {
			const sourceAttrs = await store.getAttributes(runId, path);
			if (sourceAttrs && typeof sourceAttrs.tags === "string") {
				destTags = sourceAttrs.tags;
			}
		}

		const destScheme = Entries.scheme(to);
		const existing = await store.getBody(runId, to);
		const warning =
			existing !== null && destScheme !== null
				? `Overwrote existing entry at ${to}`
				: null;

		const sourceTokens = countTokens(source);
		const destOldTokens = existing !== null ? countTokens(existing) : 0;
		const beforeTokens = sourceTokens + destOldTokens;
		const afterTokens = sourceTokens;

		if (destScheme === null) {
			// Bare-file destination: decompose into (a) a resolved mv
			// recap (model audit + setProposal linkage for the post-
			// accept rm) + (b) a set proposal at destination. On set
			// acceptance, #onAccepted matches the recap by setProposal
			// linkage and emits an rm proposal for the source. Serial:
			// reject the set → no rm prompt; move fails atomically.
			const setProposalPath = await store.logPath(runId, loopId, turn, "set");
			await store.set({
				runId,
				turn,
				loopId,
				path: entry.resultPath,
				body: "",
				state: "resolved",
				attributes: {
					from: path,
					to,
					isMove: true,
					warning,
					setProposal: setProposalPath,
					beforeActionTokens: beforeTokens,
					afterActionTokens: afterTokens,
				},
			});
			const existingBody = existing == null ? "" : existing;
			const patch = generatePatch(to, existingBody, source);
			await store.set({
				runId,
				turn,
				loopId,
				path: setProposalPath,
				body: "",
				state: "proposed",
				attributes: {
					path: to,
					patch,
					patched: source,
					op: "new",
					opPositions: [
						{
							kind: "new",
							startLine: 1,
							lineCount: countLines(source),
							content: source,
						},
					],
					visibility,
					beforeActionTokens: beforeTokens,
					afterActionTokens: afterTokens,
				},
			});
		} else {
			await store.set({
				runId,
				turn,
				path: to,
				body: source,
				state: "resolved",
				visibility,
				attributes: destTags ? { tags: destTags } : null,
				loopId,
			});
			await store.rm({ runId: runId, path: path });
			await store.set({
				runId,
				turn,
				path: entry.resultPath,
				body: "",
				state: "resolved",
				attributes: {
					from: path,
					to,
					isMove: true,
					warning,
					beforeActionTokens: beforeTokens,
					afterActionTokens: afterTokens,
				},
				loopId,
			});
		}
	}

	full(entry) {
		return entry.body;
	}
}

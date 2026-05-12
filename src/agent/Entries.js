import slugify from "../sql/functions/slugify.js";
import { EntryOverflowError, PermissionError } from "./errors.js";
import encodeSegment from "./pathEncode.js";

const UPDATE_BODY_MAX = 80;

// SQLite surfaces the body-length CHECK as either an error code or message;
// match both because the driver build varies in the wild.
function isBodyOverflow(err) {
	if (!err) return false;
	if (err.code === "SQLITE_CONSTRAINT_CHECK") return true;
	return err.message.includes("CHECK") && err.message.includes("length(body)");
}

function translateBodyOverflow(err, path, body) {
	if (!isBodyOverflow(err)) return err;
	const size = body == null ? 0 : body.length;
	return new EntryOverflowError(path, size);
}

// Skipped by the auto-failure hook to break recursion (error.log emits its own).
const ERROR_PATH_RE = /^log:\/\/\d+\/\d+\/\d+\/error$/;

// Stream channels — failure already captured by the parent action entry.
const CHANNEL_PATH_RE = /^(env|sh):\/\/\d+\/\d+\/\d+_\d+$/;

// Run-status writes set state via writer:"system" with no loop scope.
// These are lifecycle markers, not action failures — no strike.
const RUN_PATH_RE = /^run:\/\//;

export default class Entries {
	#db;
	#onChanged;
	#onError;
	#onFailed;
	#onSoftError;
	#schemes = new Map();
	#schemesLoaded = null;
	#seq = 0;
	#pendingResolutions = new Map();

	// onError: catches storage-layer rejections (EntryOverflowError) and routes
	// to error.log → strike; callers don't handle at each write site.
	// onFailed: every state="failed" on a non-error path fires this so a
	// sibling log://<L>/<T>/<S>/error entry materializes (model-facing).
	constructor(
		db,
		{
			onChanged = null,
			onError = null,
			onFailed = null,
			onSoftError = null,
		} = {},
	) {
		this.#db = db;
		this.#onChanged = onChanged;
		this.#onError = onError;
		this.#onFailed = onFailed;
		this.#onSoftError = onSoftError;
	}

	async loadSchemes(db) {
		const rows = await (db || this.#db).get_all_schemes.all();
		this.#schemes.clear();
		for (const row of rows) {
			this.#schemes.set(row.name, row);
		}
	}

	async #ensureSchemes() {
		if (!this.#schemesLoaded) {
			this.#schemesLoaded = this.loadSchemes();
		}
		return this.#schemesLoaded;
	}

	#emitChanged(runId, path, changeType) {
		if (this.#onChanged) this.#onChanged({ runId, path, changeType });
	}

	static scheme(path) {
		if (!path) return null;
		const idx = path.indexOf("://");
		return idx > 0 ? path.slice(0, idx) : null;
	}

	// Parse a `log://<L>/<T>/<S>/<action>` path into its components.
	// Returns null when the path doesn't match the canonical log shape
	// — callers gate on this and either thread loopId from another
	// source or hard-fail. Never silently fall back.
	static parseLogPath(path) {
		if (!path) return null;
		const m = path.match(/^log:\/\/(\d+)\/(\d+)\/(\d+)\/(\w+)$/);
		if (!m) return null;
		return {
			loopSequence: Number(m[1]),
			turn: Number(m[2]),
			seq: Number(m[3]),
			action: m[4],
		};
	}

	static normalizePath(path) {
		if (!path) return path;
		if (!path.includes("://")) {
			// Strip leading `./` so `./main.go` and `main.go` are one entry.
			if (path.startsWith("./")) return path.slice(2);
			return path;
		}
		const sep = path.indexOf("://");
		const scheme = path.slice(0, sep).toLowerCase();
		const rest = path.slice(sep + 3);
		try {
			const decoded = decodeURIComponent(rest);
			return `${scheme}://${decoded.split("/").map(encodeSegment).join("/")}`;
		} catch {
			return `${scheme}://${rest.split("/").map(encodeSegment).join("/")}`;
		}
	}

	async nextTurn(runId, loopId) {
		// Per-loop turn counter. log://<L>/<T>/<S>/<action>'s T resets
		// at each new loop. We also bump runs.next_turn for run-absolute
		// telemetry (rpc /run/{alias} reports it as "last turn").
		await this.#db.next_turn.run({ run_id: runId });
		const row = await this.#db.next_loop_turn.get({ loop_id: loopId });
		return row.turn;
	}

	async nextSeq(runId, loopId, turn) {
		const row = await this.#db.next_turn_seq.get({
			run_id: runId,
			loop_id: loopId,
			turn,
		});
		return row.seq;
	}

	async dedup(runId, scheme, target, turn) {
		const encodedTarget = encodeSegment(target);
		const turnPrefix = turn ? `turn_${turn}/` : "";
		const candidate = `${scheme}://${turnPrefix}${encodedTarget}`;
		const existing = await this.#db.get_entry_body.get({
			run_id: runId,
			path: candidate,
		});
		if (!existing) return candidate;
		return `${candidate}_${++this.#seq}`;
	}

	// log://<L>/<T>/<S>/<action> — L=loop.sequence, T=turn (per-loop),
	// S=allocated per-turn sequence. Action is the verb.
	async logPath(runId, loopId, turn, action) {
		const loop = await this.#db.get_loop_sequence.get({ id: loopId });
		const seq = await this.nextSeq(runId, loopId, turn);
		return `log://${loop.sequence}/${turn}/${seq}/${action}`;
	}

	async slugPath(runId, scheme, content, tags) {
		// tags > content > sequence-only.
		let source = "";
		if (tags) source = tags;
		else if (content) source = content;
		const base = slugify(source);
		const prefix = `${scheme}://`;

		if (!base) return `${prefix}${++this.#seq}`;

		const candidate = `${prefix}${base}`;
		const existing = await this.#db.get_entry_body.get({
			run_id: runId,
			path: candidate,
		});
		if (!existing) return candidate;

		return `${prefix}${base}_${++this.#seq}`;
	}

	async #schemeRules(scheme) {
		await this.#ensureSchemes();
		const row = scheme ? this.#schemes.get(scheme) : null;
		const kind = row?.default_scope ? row.default_scope : "run";
		const category = row?.category ? row.category : "logging";
		let writers = ["model", "plugin"];
		if (row?.writable_by) {
			const parsed =
				typeof row.writable_by === "string"
					? JSON.parse(row.writable_by)
					: row.writable_by;
			if (Array.isArray(parsed)) writers = parsed;
		} else if (scheme && !row) {
			// Unknown scheme: model can't invent paths. Plugins can
			// still write (some surfaces ensure schemes lazily).
			writers = ["plugin"];
		}
		return { kind, writers, category };
	}

	// Handler-entry gate: tool plugins call this with the model's target
	// path before any mutation (body write, visibility flip, attribute
	// set). Failure throws PermissionError which dispatch surfaces as an
	// error.log → strike. Bare paths (no scheme) are always writable.
	async assertWritable(path, writer) {
		const scheme = Entries.scheme(path);
		if (!scheme) return;
		const { writers } = await this.#schemeRules(scheme);
		if (!writers.includes(writer)) {
			throw new PermissionError(scheme, writer, writers);
		}
	}

	#defaultVisibility() {
		return "indexed";
	}

	#resolveScope(kind, runId, projectId) {
		if (kind === "global") return "global";
		if (kind === "project") {
			if (!projectId) {
				throw new Error(
					"project-scoped write requires projectId; caller must pass it to set()",
				);
			}
			return `project:${projectId}`;
		}
		return `run:${runId}`;
	}

	async set(args) {
		if (!args.runId) throw new Error("set: runId is required");
		if (!args.path) throw new Error("set: path is required");
		// run:// is the run lifecycle surface and lives exclusively on
		// the runs table (runs.status, runs.outcome, runs.prompt). It
		// is not addressable through entries / run_views. RPC dispatch
		// routes `set run://*` to runs-table mutations directly.
		if (typeof args.path === "string" && args.path.startsWith("run://")) {
			throw new Error(
				`set: run://* paths are not addressable through entries (path: ${args.path}). Use db.set_run_state / db.update_run_status instead.`,
			);
		}
		try {
			return await this.#setImpl(args);
		} catch (err) {
			// EntryOverflowError → error.log when onError is wired.
			if (err instanceof EntryOverflowError && this.#onError) {
				const { runId, loopId = null, turn = 0 } = args;
				await this.#onError({
					runId,
					loopId,
					turn,
					error: err,
				});
				return;
			}
			throw err;
		}
	}

	async #setImpl({
		runId,
		projectId = null,
		turn = 0,
		path,
		body,
		state,
		visibility,
		outcome = null,
		attributes,
		append,
		bodyFilter = null,
		pattern,
		hash = null,
		loopId = null,
		writer = "plugin",
	}) {
		const isPattern = pattern === true || bodyFilter !== null;

		if (isPattern) {
			if (body != null && !append) {
				try {
					await this.#db.update_body_by_pattern.run({
						run_id: runId,
						path,
						body: bodyFilter,
						new_body: body,
					});
				} catch (err) {
					throw translateBodyOverflow(err, path, body);
				}
				await this.#db.bump_write_count_by_pattern.run({
					run_id: runId,
					path,
					body: bodyFilter,
				});
				this.#emitChanged(runId, path, "body");
			}
			if (visibility === "indexed") {
				await this.#db.promote_by_pattern.run({
					run_id: runId,
					path,
					body: bodyFilter,
					turn,
				});
				this.#emitChanged(runId, path, "promote");
			} else if (visibility === "archived") {
				await this.#db.demote_by_pattern.run({
					run_id: runId,
					path,
					body: bodyFilter,
				});
				this.#emitChanged(runId, path, "demote");
			}
			return;
		}

		const normalized = Entries.normalizePath(path);
		const scheme = Entries.scheme(normalized);

		if (append) {
			if (body == null) throw new Error("set: append requires body");
			try {
				await this.#db.append_entry_body.run({
					run_id: runId,
					path: normalized,
					chunk: body,
				});
			} catch (err) {
				throw translateBodyOverflow(err, normalized, body);
			}
			this.#emitChanged(runId, normalized, "append");
			return;
		}

		if (body == null) {
			if (state != null) {
				await this.#db.resolve_known_entry_view.run({
					run_id: runId,
					path: normalized,
					state,
					outcome,
				});
				this.#emitChanged(runId, normalized, "resolve");
				this.#drainPendingResolution(runId, normalized);
				if (state === "failed") {
					await this.#fireFailed({
						runId,
						turn,
						loopId,
						path: normalized,
						outcome,
					});
				}
			}
			if (visibility != null) {
				await this.#db.set_visibility.run({
					run_id: runId,
					path: normalized,
					visibility,
				});
				this.#emitChanged(runId, normalized, "visibility");
			}
			if (attributes != null) {
				await this.#db.update_entry_attributes.run({
					run_id: runId,
					path: normalized,
					attributes: JSON.stringify(attributes),
				});
				this.#emitChanged(runId, normalized, "attributes");
			}
			return;
		}

		const { kind, writers, category } = await this.#schemeRules(scheme);
		if (!writers.includes(writer)) {
			throw new PermissionError(scheme, writer, writers);
		}
		const scope = this.#resolveScope(kind, runId, projectId);
		const effectiveAttributes = attributes ? { ...attributes } : null;
		if (scheme === "log" && effectiveAttributes) {
			const m = normalized.match(/^log:\/\/\d+\/\d+\/\d+\/(\w+)$/);
			if (m) effectiveAttributes.action = m[1];
		}
		let entry;
		try {
			entry = await this.#db.upsert_entry.get({
				scope,
				path: normalized,
				body,
				attributes: effectiveAttributes
					? JSON.stringify(effectiveAttributes)
					: null,
				hash,
			});
		} catch (err) {
			throw translateBodyOverflow(err, normalized, body);
		}
		const effectiveState = state === undefined ? "resolved" : state;
		// Visibility: explicit > preserve-existing > scheme-default.
		let effectiveVisibility;
		if (visibility !== undefined) {
			effectiveVisibility = visibility;
		} else {
			const existing = await this.getState(runId, normalized);
			if (existing?.visibility) {
				effectiveVisibility = existing.visibility;
			} else {
				effectiveVisibility = this.#defaultVisibility(scheme, category);
			}
		}
		await this.#db.upsert_run_view.run({
			run_id: runId,
			entry_id: entry.id,
			loop_id: loopId,
			turn,
			state: effectiveState,
			outcome,
			visibility: effectiveVisibility,
		});
		this.#emitChanged(runId, normalized, "upsert");
		if (effectiveState !== "proposed") {
			this.#drainPendingResolution(runId, normalized);
		}
		if (effectiveState === "failed") {
			await this.#fireFailed({
				runId,
				turn,
				loopId,
				path: normalized,
				body,
				outcome,
			});
		}
	}

	async #fireFailed({ runId, turn, loopId, path, body, outcome }) {
		if (!this.#onFailed) return;
		if (ERROR_PATH_RE.test(path)) return;
		if (CHANNEL_PATH_RE.test(path)) return;
		if (RUN_PATH_RE.test(path)) return;
		let message = body;
		if (!message) {
			if (outcome) message = `failed: ${outcome}`;
			else message = `failed: ${path}`;
		}
		await this.#onFailed({
			runId,
			turn,
			loopId,
			sourcePath: path,
			body: message,
			outcome,
		});
	}

	async get({
		runId,
		turn = 0,
		path,
		bodyFilter = null,
		visibility = "indexed",
	}) {
		if (!runId) throw new Error("get: runId is required");
		if (!path) throw new Error("get: path is required");
		if (visibility === "indexed") {
			await this.#db.promote_by_pattern.run({
				run_id: runId,
				path,
				body: bodyFilter,
				turn,
			});
		} else {
			await this.#db.demote_by_pattern.run({
				run_id: runId,
				path,
				body: bodyFilter,
			});
		}
		this.#emitChanged(runId, path, "promote");
	}

	async rm({ runId, path, bodyFilter = null, filesOnly = false }) {
		if (!runId) throw new Error("rm: runId is required");
		if (!path) throw new Error("rm: path is required");
		if (filesOnly) {
			await this.#db.delete_file_entries_by_pattern.run({
				run_id: runId,
				pattern: path,
			});
		} else if (bodyFilter !== null || /[*?[\]]/.test(path)) {
			await this.#db.delete_entries_by_pattern.run({
				run_id: runId,
				path,
				body: bodyFilter,
			});
		} else {
			const normalized = Entries.normalizePath(path);
			await this.#db.delete_known_entry.run({
				run_id: runId,
				path: normalized,
			});
		}
		this.#emitChanged(runId, path, "remove");
	}

	async cp({
		runId,
		turn = 0,
		from,
		to,
		visibility,
		attributes,
		loopId,
		writer,
	}) {
		if (!runId) throw new Error("cp: runId is required");
		if (!from || !to) throw new Error("cp: from and to are required");
		const sourceBody = await this.getBody(runId, from);
		if (sourceBody === null) return;
		await this.set({
			runId,
			turn,
			path: to,
			body: sourceBody,
			visibility,
			attributes,
			loopId,
			writer,
		});
	}

	async mv({
		runId,
		turn = 0,
		from,
		to,
		visibility,
		attributes,
		loopId,
		writer,
	}) {
		if (!runId) throw new Error("mv: runId is required");
		if (!from || !to) throw new Error("mv: from and to are required");
		await this.cp({
			runId,
			turn,
			from,
			to,
			visibility,
			attributes,
			loopId,
			writer,
		});
		await this.rm({ runId, path: from });
	}

	// Inner text capped at UPDATE_BODY_MAX with soft-error emission.
	async update({
		runId,
		turn = 0,
		body,
		status = 102,
		attributes = {},
		loopId = null,
		writer = "plugin",
	}) {
		if (!runId) throw new Error("update: runId is required");
		if (body == null) throw new Error("update: body is required");
		let storedBody = body;
		if (body.length > UPDATE_BODY_MAX) {
			storedBody = body.slice(0, UPDATE_BODY_MAX);
			if (this.#onSoftError) {
				await this.#onSoftError({
					runId,
					turn,
					loopId,
					message: "YOU MUST keep the update body to <= 80 characters",
				});
			}
		}
		const path = await this.logPath(runId, loopId, turn, "update");
		await this.set({
			runId,
			turn,
			path,
			body: storedBody,
			state: "resolved",
			loopId,
			writer,
			attributes: { status, ...attributes },
		});
		return path;
	}

	async getEntriesByPattern(
		runId,
		path,
		body = null,
		{
			limit = null,
			offset = null,
			since = null,
			includeAuditSchemes = false,
		} = {},
	) {
		return this.#db.get_entries_by_pattern.all({
			run_id: runId,
			path,
			body: body ? body : null,
			limit,
			offset,
			since,
			include_audit_schemes: includeAuditSchemes ? 1 : null,
		});
	}

	#drainPendingResolution(runId, normalized) {
		const key = `${runId}:${normalized}`;
		const resolver = this.#pendingResolutions.get(key);
		if (resolver) {
			this.#pendingResolutions.delete(key);
			resolver();
		}
	}

	async waitForResolution(runId, path) {
		// Pre-check: yolo may have already flipped state synchronously.
		const current = await this.getState(runId, path);
		if (
			current &&
			current.state !== "proposed" &&
			current.state !== "streaming"
		) {
			return;
		}
		const normalized = Entries.normalizePath(path);
		const key = `${runId}:${normalized}`;
		return new Promise((resolve) => {
			this.#pendingResolutions.set(key, resolve);
		});
	}

	async getLog(runId) {
		return this.#db.get_results.all({ run_id: runId });
	}

	async getEntries(runId) {
		return this.#db.get_known_entries.all({ run_id: runId });
	}

	async getFileEntries(runId) {
		return this.#db.get_file_entries.all({ run_id: runId });
	}

	async getFileStatesByPattern(runId, pattern) {
		return this.#db.get_file_states_by_pattern.all({ run_id: runId, pattern });
	}

	async hasRejections(runId, loopId) {
		const row = await this.#db.has_rejections.get({
			run_id: runId,
			loop_id: loopId,
		});
		return row.count > 0;
	}

	async hasAcceptedActions(runId) {
		const row = await this.#db.has_accepted_actions.get({ run_id: runId });
		return row.count > 0;
	}

	async getUnresolved(runId) {
		return this.#db.get_unresolved.all({ run_id: runId });
	}

	async countUnknowns(runId) {
		const row = await this.#db.count_unknowns.get({ run_id: runId });
		return row.count;
	}

	async getUnknownValues(runId) {
		const rows = await this.#db.get_unknown_values.all({ run_id: runId });
		return new Set(rows.map((r) => r.body));
	}

	async getUnknowns(runId) {
		return this.#db.get_unknowns.all({ run_id: runId });
	}

	async forkEntries(parentRunId, childRunId) {
		await this.#db.fork_known_entries.run({
			new_run_id: childRunId,
			parent_run_id: parentRunId,
		});
	}

	async setNextTurn(runId, nextTurn) {
		await this.#db.set_next_turn.run({
			run_id: runId,
			next_turn: nextTurn,
		});
	}

	// SELECT-then-UPDATE: RETURNING can't cross to the view layer in SQLite.
	// Returns paths archived so the budget rescue can synthesize a
	// `<get manifest/>` log entry naming what was hidden.
	async archiveTurnEntries(runId, turn) {
		const targets = await this.#db.get_turn_archive_targets.all({
			run_id: runId,
			turn,
		});
		await this.#db.archive_turn_entries.run({ run_id: runId, turn });
		return targets;
	}

	async getRun(runId) {
		return this.#db.get_run_by_id.get({ id: runId });
	}

	async updateTurnStats(stats) {
		return this.#db.update_turn_stats.run(stats);
	}

	async getBody(runId, path) {
		const row = await this.#db.get_entry_body.get({
			run_id: runId,
			path: Entries.normalizePath(path),
		});
		if (!row) return null;
		return row.body;
	}

	async setAttributes(runId, path, attrs) {
		const normalized = Entries.normalizePath(path);
		await this.#db.update_entry_attributes.run({
			run_id: runId,
			path: normalized,
			attributes: JSON.stringify(attrs),
		});
		this.#emitChanged(runId, normalized, "attributes");
	}

	async getState(runId, path) {
		return this.#db.get_entry_state.get({
			run_id: runId,
			path: Entries.normalizePath(path),
		});
	}

	async getAttributes(runId, path) {
		const row = await this.#db.get_entry_attributes.get({
			run_id: runId,
			path: Entries.normalizePath(path),
		});
		return row?.attributes ? JSON.parse(row.attributes) : null;
	}

	async getTurnAudit(runId, turn) {
		return this.#db.get_turn_audit.all({ run_id: runId, turn });
	}

	static toolFromPath(path) {
		return Entries.scheme(path);
	}

	static isSystemPath(path) {
		return path.includes("://");
	}
}

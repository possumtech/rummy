/**
 * Universal run-digest tool. Reads any rummy*.db (e2e, demo, bench, dev)
 * and emits per-run forensic artifacts. First-order tool, not bench-
 * specific — use it on anything with a rummy*.db inside.
 *
 *   <out>/digest.md       Run-shape header + waterfall: per-turn line
 *                         with status, update body, indented emission
 *                         list, and a reasoning excerpt.
 *   <out>/digest.json     Same data, machine-queryable.
 *   <out>/reasoning.md    Per-turn reasoning_content (full).
 *   <out>/packets.md      Per-turn assembled wire packets.
 *   <out>/digest_skipped  Written when no rummy*.db is present.
 *
 *   <sweep>/index.csv     Greppable per-task summary.
 *   <sweep>/errors.md     Cross-task aggregated error report.
 *   <sweep>/errors.json   Same, machine-queryable.
 *
 * Read-only derivative; never source-of-truth. Safe to re-run.
 *
 * Usage:
 *   node bin/digest.js <sweep-dir>           sweep + index + errors
 *   node bin/digest.js <task-dir>            single task + errors
 *   node bin/digest.js <path-to-rummy.db>    bare DB → sibling .digest/ dir
 *   node bin/digest.js                       latest tbench sweep
 */

import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Default sweep root for the no-arg invocation: the tbench results dir
// historically holds the latest of everything. Resolved relative to the
// project root (one level up from bin/).
const RESULTS_DIR = join(__dirname, "..", "test", "tbench", "results");
// Bare-DB invocation output. The full per-run pile (subdirs per alias
// for multi-run DBs) lives in /tmp/rummy_digest/ — clobbered each run.
// Sweep / task-dir invocations keep writing alongside source dirs.
const PILE_DIR = "/tmp/rummy_digest";
// Single readable digest that mirrors the most recent run from the DB.
// Flat files only — no nested folders. Clobbered on each invocation.
const PUBLIC_DIR = join(__dirname, "..", "test", "digest");

const MAX_LOOP_TURNS = Number(process.env.RUMMY_MAX_LOOP_TURNS) || 99;
const REASONING_RUNAWAY_CHARS = 8000;

// Locate the agent's sqlite DB inside a task dir's agent/ folder. Tbench
// writes `rummy.db`; programbench writes `rummy_programbench.db` (so the
// host-side audit DB is segregated from any project-internal `rummy.db`
// the agent might create). Returns absolute path or null. Empty stubs
// (zero-length leftovers from aborted runs) are ignored.
function findAgentDb(taskDir) {
	const agentDir = join(taskDir, "agent");
	if (!existsSync(agentDir)) return null;
	let names;
	try {
		names = readdirSync(agentDir);
	} catch {
		return null;
	}
	const candidates = names
		.filter((n) => /^rummy.*\.db$/.test(n))
		.map((n) => join(agentDir, n))
		.filter((p) => {
			try {
				return statSync(p).size > 0;
			} catch {
				return false;
			}
		});
	if (candidates.length === 0) return null;
	const canonical = candidates.find((p) => p.endsWith("/rummy.db"));
	if (canonical) return canonical;
	return candidates.toSorted((a, b) => statSync(b).size - statSync(a).size)[0];
}

function isTaskDir(dir) {
	return findAgentDb(dir) != null;
}

function findTaskDirs(sweepDir) {
	const result = [];
	function walk(dir, depth) {
		if (depth > 4) return;
		let names;
		try {
			names = readdirSync(dir);
		} catch {
			return;
		}
		for (const name of names) {
			const full = join(dir, name);
			let s;
			try {
				s = statSync(full);
			} catch {
				continue;
			}
			if (!s.isDirectory()) continue;
			if (isTaskDir(full)) {
				result.push(full);
				continue;
			}
			walk(full, depth + 1);
		}
	}
	walk(sweepDir, 0);
	return result;
}

function readReward(taskDir) {
	const p = join(taskDir, "verifier", "reward.txt");
	if (!existsSync(p)) return null;
	const r = readFileSync(p, "utf8").trim();
	if (r === "0" || r === "1") return Number(r);
	return null;
}

function readRunSummary(taskDir) {
	const p = join(taskDir, "agent", "rummy.txt");
	if (!existsSync(p)) return null;
	const text = readFileSync(p, "utf8");
	const m = text.match(/__RUMMY_RUN_SUMMARY__\s+(\{.*\})\s*$/m);
	if (!m) return null;
	try {
		return JSON.parse(m[1]);
	} catch {
		return null;
	}
}

function parseAttrs(s) {
	if (s == null) return {};
	if (typeof s === "object") return s;
	try {
		return JSON.parse(s);
	} catch {
		return {};
	}
}

// log://<L>/<T>/<S>/<action> — T is the per-loop turn segment.
const TURN_FROM_PATH = /^log:\/\/\d+\/(\d+)\/\d+\/\w+$/;

function turnFromPath(path) {
	const m = TURN_FROM_PATH.exec(path);
	return m ? Number(m[1]) : null;
}

function actionFromPath(path) {
	const m = path.match(/^log:\/\/\d+\/\d+\/\d+\/(\w+)$/);
	return m ? m[1] : null;
}

function pathSlug(path) {
	// Action is the terminal segment; the slug-in-path model is gone.
	const m = path.match(/^log:\/\/\d+\/\d+\/\d+\/(\w+)$/);
	if (!m) return path;
	try {
		return decodeURIComponent(m[1]);
	} catch {
		return m[1];
	}
}

function summarize(text, n = 80) {
	if (!text) return "";
	const flat = text.replace(/\s+/g, " ").trim();
	if (flat.length <= n) return flat;
	return `${flat.slice(0, n)}…`;
}

// Read all runs from a DB plus their per-run data. Tbench task DBs have
// exactly one run; e2e TestDb DBs have many (one per test invocation).
// The caller drives a per-run digest pass either way.
function readDb(rummyDb) {
	const db = new DatabaseSync(rummyDb, { readOnly: true });

	const runs = db.prepare("SELECT * FROM runs ORDER BY id").all();
	const turnsStmt = db.prepare(
		`SELECT sequence, total_tokens, prompt_tokens, completion_tokens,
		        cached_tokens, reasoning_tokens, reasoning_content
		 FROM turns
		 WHERE run_id = ?
		 ORDER BY sequence`,
	);
	const logStmt = db.prepare(
		`SELECT e.path, e.body, e.attributes, e.scheme,
		        rv.state, rv.outcome, rv.visibility, rv.turn
		 FROM entries e
		 JOIN run_views rv ON rv.entry_id = e.id
		 WHERE rv.run_id = ?
		   AND e.scheme = 'log'
		 ORDER BY e.id`,
	);
	const promptStmt = db.prepare(
		`SELECT e.body
		 FROM entries e
		 JOIN run_views rv ON rv.entry_id = e.id
		 WHERE rv.run_id = ? AND e.path = 'prompt://1'
		 LIMIT 1`,
	);
	// Per-turn assembled packet bytes. system://N + user://N are what we
	// sent to the LLM; assistant://N is the parsed content; model://N is
	// the raw response wrapper (includes reasoning_content, finish_reason,
	// usage). reasoning://N is the bare reasoning channel when the model
	// surfaced one.
	const packetStmt = db.prepare(
		`SELECT e.path, e.body
		 FROM entries e
		 JOIN run_views rv ON rv.entry_id = e.id
		 WHERE rv.run_id = ?
		   AND (e.path GLOB 'system://*' OR e.path GLOB 'user://*'
		        OR e.path GLOB 'assistant://*' OR e.path GLOB 'model://*'
		        OR e.path GLOB 'reasoning://*')
		 ORDER BY e.id`,
	);

	const perRun = runs.map((run) => ({
		run,
		turns: turnsStmt.all(run.id),
		logEntries: logStmt.all(run.id),
		packetEntries: packetStmt.all(run.id),
		prompt: promptStmt.get(run.id)?.body ?? null,
	}));

	db.close();
	return perRun;
}

// Build per-turn rows: one entry per turn with its update + emissions + errors.
function buildTurns(turns, logEntries) {
	const byTurn = new Map();
	for (const t of turns) {
		byTurn.set(t.sequence, {
			turn: t.sequence,
			totalTokens: t.total_tokens,
			promptTokens: t.prompt_tokens,
			completionTokens: t.completion_tokens,
			cachedTokens: t.cached_tokens,
			reasoningTokens: t.reasoning_tokens,
			reasoningChars: (t.reasoning_content || "").length,
			reasoning: t.reasoning_content || "",
			update: null, // {status, body, state, outcome}
			emissions: [], // {action, slug, attrs, body, state, outcome}
			errors: [], // {body, attrs}
		});
	}
	// Make sure we have a row even for "ghost" turns where the LLM call
	// failed before turn-row creation (rare but possible).
	for (const e of logEntries) {
		const turn = turnFromPath(e.path);
		if (turn == null) continue;
		if (!byTurn.has(turn)) {
			byTurn.set(turn, {
				turn,
				totalTokens: null,
				promptTokens: null,
				completionTokens: null,
				cachedTokens: null,
				reasoningTokens: null,
				reasoningChars: 0,
				reasoning: "",
				update: null,
				emissions: [],
				errors: [],
			});
		}
		const row = byTurn.get(turn);
		const action = actionFromPath(e.path);
		const attrs = parseAttrs(e.attributes);
		if (action === "update") {
			row.update = {
				status: attrs.status ?? null,
				body: e.body,
				state: e.state,
				outcome: e.outcome,
			};
		} else if (action === "error") {
			row.errors.push({
				body: e.body,
				attrs,
				slug: pathSlug(e.path),
				state: e.state,
				outcome: e.outcome,
			});
		} else {
			row.emissions.push({
				action,
				slug: pathSlug(e.path),
				targetPath: attrs.path ?? null,
				visibility: attrs.visibility ?? null,
				query: attrs.query ?? null,
				command: attrs.command ?? null,
				body: e.body,
				state: e.state,
				outcome: e.outcome,
			});
		}
	}
	return [...byTurn.values()].sort((a, b) => a.turn - b.turn);
}

function classifyMarkers(reward, runSummary, turnRows) {
	const markers = [];
	const status = runSummary?.status ?? null;
	if (reward === 1) markers.push("passed");
	if (reward === 0 && status === 200)
		markers.push("claim_success_verifier_fail");
	if (status === 499 && turnRows.length >= MAX_LOOP_TURNS - 1) {
		markers.push("max_loop_turns");
	}
	if (status === 413) markers.push("context_overflow");
	if (status === 500) markers.push("dispatch_500");

	let strikeAbandon = false;
	let runawayTurn = null;
	let parserWarn = false;
	for (const row of turnRows) {
		const stuck =
			row.reasoningChars >= REASONING_RUNAWAY_CHARS &&
			row.emissions.length === 0 &&
			!row.update;
		if (stuck) runawayTurn = row.turn;
		for (const err of row.errors) {
			const body = err.body || "";
			if (body.startsWith("Abandoned after")) strikeAbandon = true;
			if (body.startsWith("Unclosed") || body.includes("Tool call limit")) {
				parserWarn = true;
			}
		}
	}
	if (strikeAbandon) markers.push("strike_abandon");
	if (runawayTurn != null) markers.push(`reasoning_runaway_t${runawayTurn}`);
	if (parserWarn) markers.push("parser_warning");
	if (!runSummary) markers.push("exfil_fail");
	return markers;
}

// Render an emission as a single waterfall line.
function renderEmission(em) {
	const fail = em.state === "failed" ? " ✗" : "";
	const outcome = em.outcome ? ` [${em.outcome}]` : "";
	const target = em.targetPath ?? em.slug;
	const vis = em.visibility ? ` visibility=${em.visibility}` : "";
	const query = em.query ? ` "${summarize(em.query, 60)}"` : "";
	const command = em.command ? ` "${summarize(em.command, 60)}"` : "";
	return `  ← ${em.action} ${target}${vis}${query}${command}${fail}${outcome}`;
}

function renderError(err) {
	return `  ✗ error: ${summarize(err.body, 100)}`;
}

// "What happened" header — five lines a forensic reader can scan in
// seconds before deciding whether to drop into the waterfall.
function renderRunShape(turnRows) {
	let lastUpdate = null;
	let lastEmissionTurn = null;
	let setActions = 0;
	let getActions = 0;
	let searchActions = 0;
	for (const row of turnRows) {
		if (row.update) lastUpdate = { turn: row.turn, ...row.update };
		if (row.emissions.length > 0) lastEmissionTurn = row.turn;
		for (const em of row.emissions) {
			if (em.action === "set") setActions++;
			else if (em.action === "get") getActions++;
			else if (em.action === "search") searchActions++;
		}
	}
	const lastUpdateLine = lastUpdate
		? `T${lastUpdate.turn} status=${lastUpdate.status ?? "—"} "${summarize(lastUpdate.body, 60)}"`
		: "(none)";
	return [
		`Last update:    ${lastUpdateLine}`,
		`Last emission:  ${lastEmissionTurn != null ? `T${lastEmissionTurn}` : "(none)"}`,
		`Action mix:     set=${setActions} get=${getActions} search=${searchActions}`,
	];
}

function renderWaterfall(
	taskName,
	prompt,
	runSummary,
	reward,
	turnRows,
	markers,
) {
	const lines = [];
	lines.push(`# ${taskName}`);
	lines.push("");
	const status = runSummary?.status ?? "?";
	const totalTurns = runSummary?.turns ?? turnRows.length;
	const cost =
		runSummary?.cost != null ? `$${runSummary.cost.toFixed(4)}` : "?";
	const tokens = runSummary?.tokens
		? `prompt=${runSummary.tokens.prompt} completion=${runSummary.tokens.completion} cached=${runSummary.tokens.cached}`
		: "?";
	const rewardStr = reward == null ? "—" : reward === 1 ? "PASS" : "FAIL";
	lines.push(
		`status=${status}  reward=${rewardStr}  turns=${totalTurns}  cost=${cost}  tokens=${tokens}`,
	);
	if (markers.length > 0) {
		lines.push("");
		lines.push(`markers: ${markers.join(", ")}`);
	}
	lines.push("");
	lines.push("## Run shape");
	lines.push("");
	for (const l of renderRunShape(turnRows)) lines.push(l);
	lines.push("");
	if (prompt) {
		lines.push("## Prompt");
		lines.push(summarize(prompt, 240));
		lines.push("");
	}
	lines.push("## Waterfall");
	for (const row of turnRows) {
		const upStatus = row.update?.status ?? "—";
		const upBody = row.update ? summarize(row.update.body, 80) : "(no update)";
		const upFail =
			row.update?.state === "failed" ? ` ✗ ${row.update.outcome ?? ""}` : "";
		lines.push(`T${row.turn}: ${upStatus}  "${upBody}"${upFail}`);
		if (row.reasoning)
			lines.push(`  ↳ reasoning: ${summarize(row.reasoning, 140)}`);
		for (const em of row.emissions) lines.push(renderEmission(em));
		for (const err of row.errors) lines.push(renderError(err));
	}
	lines.push("");
	lines.push("## Drill-down");
	lines.push("- agent/rummy.txt   (full trace, when present)");
	lines.push("- agent/rummy.db    (sqlite — entries, run_views, turns)");
	lines.push("- reasoning.md      (per-turn reasoning_content)");
	lines.push("- packets.md        (per-turn assembled wire packets)");
	return lines.join("\n");
}

function renderReasoning(taskName, turnRows) {
	const lines = [];
	lines.push(`# Reasoning: ${taskName}`);
	for (const row of turnRows) {
		lines.push("");
		lines.push(`## Turn ${row.turn}`);
		if (row.reasoning) {
			lines.push("");
			lines.push(row.reasoning);
		} else {
			lines.push("");
			lines.push("(no reasoning_content)");
		}
	}
	return lines.join("\n");
}

// Group packet entries (system://N / user://N / assistant://N / model://N
// / reasoning://N) by their turn number suffix.
function groupPacketsByTurn(packetEntries) {
	const byTurn = new Map();
	for (const e of packetEntries) {
		const m = e.path.match(/^([a-z]+):\/\/(\d+)$/);
		if (!m) continue;
		const role = m[1];
		const turn = Number(m[2]);
		if (!byTurn.has(turn)) byTurn.set(turn, {});
		byTurn.get(turn)[role] = e.body;
	}
	return [...byTurn.entries()]
		.toSorted(([a], [b]) => a - b)
		.map(([turn, parts]) => ({ turn, ...parts }));
}

// Per-turn packet dump: exactly what was sent (system + user) and
// received (assistant + model wrapper + reasoning) for each turn. The
// shape mirrors the wire payload so a forensic reader can see how
// errors, log entries, and state actually presented to the model.
function renderPackets(taskName, turnPackets) {
	const lines = [];
	lines.push(`# Packets: ${taskName}`);
	lines.push("");
	lines.push(
		"Per-turn assembled packets. `system` + `user` are the outgoing message;",
	);
	lines.push(
		"`assistant` is the parsed completion; `model` is the raw response",
	);
	lines.push("wrapper (usage, finish_reason); `reasoning` is the bare CoT");
	lines.push("channel when the provider surfaces one.");
	for (const p of turnPackets) {
		lines.push("");
		lines.push(`## Turn ${p.turn}`);
		for (const role of ["system", "user", "assistant", "reasoning", "model"]) {
			if (p[role] == null) continue;
			lines.push("");
			lines.push(`### ${role}://${p.turn}`);
			lines.push("");
			lines.push("```");
			lines.push(p[role]);
			lines.push("```");
		}
	}
	return lines.join("\n");
}

function digestJson({
	taskName,
	taskDir,
	prompt,
	runSummary,
	reward,
	turnRows,
	markers,
}) {
	return {
		task: taskName,
		dir: taskDir,
		reward,
		status: runSummary?.status ?? null,
		turns: runSummary?.turns ?? turnRows.length,
		tokens: runSummary?.tokens ?? null,
		cost: runSummary?.cost ?? null,
		wallSeconds: runSummary?.wallSeconds ?? null,
		markers,
		prompt: prompt ?? null,
		turnRows: turnRows.map((row) => ({
			turn: row.turn,
			totalTokens: row.totalTokens,
			reasoningChars: row.reasoningChars,
			update: row.update
				? {
						status: row.update.status,
						body: row.update.body,
						state: row.update.state,
						outcome: row.update.outcome,
					}
				: null,
			emissions: row.emissions.map((em) => ({
				action: em.action,
				targetPath: em.targetPath,
				visibility: em.visibility,
				state: em.state,
				outcome: em.outcome,
			})),
			errors: row.errors.map((err) => ({ body: err.body })),
		})),
	};
}

// Build rich error records from a run's turn rows + log entries. Each
// record carries enough forensic context to read the failure without
// drilling into the DB: the originating action's path/body (the thing
// the model tried), the verdict status/outcome, soft-vs-strike, and a
// signature for cross-task aggregation.
function collectErrors(turnRows, logEntries, runIdent) {
	const byPath = new Map();
	for (const e of logEntries) byPath.set(e.path, e);
	const records = [];
	for (const row of turnRows) {
		for (const err of row.errors) {
			const sourcePath = err.attrs?.sourcePath ?? null;
			const sourceEntry = sourcePath ? byPath.get(sourcePath) : null;
			const sourceAttrs = sourceEntry ? parseAttrs(sourceEntry.attributes) : {};
			const semanticOutcome = err.attrs?.outcome ?? err.outcome ?? null;
			records.push({
				run: runIdent,
				turn: row.turn,
				status: err.attrs?.status ?? null,
				outcome: semanticOutcome,
				rvOutcome: err.outcome ?? null,
				state: err.state ?? null,
				soft: err.state === "resolved",
				sourcePath,
				sourceAction: sourceEntry
					? {
							path: sourcePath,
							action: actionFromPath(sourcePath),
							targetPath: sourceAttrs.path ?? null,
							body: sourceEntry.body ?? "",
							state: sourceEntry.state ?? null,
							outcome: sourceEntry.outcome ?? null,
						}
					: null,
				body: err.body ?? "",
				bodySig: errorSignature({
					outcome: semanticOutcome,
					sourcePath,
					body: err.body,
				}),
			});
		}
	}
	return records;
}

// Group key for cross-task aggregation. Same outcome + same source-path
// shape (turn-stripped) + same body prefix collapses repeats. The 80-char
// body prefix accommodates "<<<<<<< SEARCH\n<context-line>" patterns
// without bleeding into the divergent tail.
const SIG_BODY_CHARS = 80;
function errorSignature({ outcome, sourcePath, body }) {
	const out = outcome ?? "—";
	const src = sourcePath ? sourcePath.replace(/^log:\/\/\d+\/\d+\/\d+\//, "log://*/*/*/") : "—";
	const flat = (body ?? "").replace(/\s+/g, " ").trim();
	const head =
		flat.length > SIG_BODY_CHARS ? `${flat.slice(0, SIG_BODY_CHARS)}…` : flat;
	return `${out} :: ${src} :: ${head}`;
}

function aggregateErrors(allErrors) {
	const total = allErrors.length;
	let strikes = 0;
	let soft = 0;
	const byOutcome = new Map();
	const byTask = new Map();
	const bySig = new Map();
	for (const er of allErrors) {
		if (er.soft) soft++;
		else strikes++;
		const oc = er.outcome ?? "—";
		byOutcome.set(oc, (byOutcome.get(oc) ?? 0) + 1);
		const taskKey = er.run.task;
		byTask.set(taskKey, (byTask.get(taskKey) ?? 0) + 1);
		if (!bySig.has(er.bodySig)) {
			bySig.set(er.bodySig, {
				sig: er.bodySig,
				count: 0,
				outcome: er.outcome,
				sourcePathPattern: er.sourcePath
					? er.sourcePath.replace(/^log:\/\/\d+\/\d+\/\d+\//, "log://*/*/*/")
					: null,
				turns: new Set(),
				tasks: new Set(),
				exemplar: null,
			});
		}
		const g = bySig.get(er.bodySig);
		g.count++;
		g.turns.add(er.turn);
		g.tasks.add(taskKey);
		if (g.exemplar == null) g.exemplar = er;
	}
	const topSignatures = [...bySig.values()]
		.toSorted((a, b) => b.count - a.count)
		.map((g) => ({
			sig: g.sig,
			count: g.count,
			outcome: g.outcome,
			sourcePathPattern: g.sourcePathPattern,
			turns: [...g.turns].toSorted((a, b) => a - b),
			tasks: [...g.tasks].toSorted(),
			exemplar: g.exemplar,
		}));
	return {
		total,
		strikes,
		soft,
		byOutcome: Object.fromEntries(
			[...byOutcome.entries()].toSorted((a, b) => b[1] - a[1]),
		),
		byTask: Object.fromEntries(
			[...byTask.entries()].toSorted((a, b) => b[1] - a[1]),
		),
		topSignatures,
	};
}

function indentBlock(text, indent = "    ") {
	if (!text) return "";
	return text
		.split("\n")
		.map((line) => `${indent}${line}`)
		.join("\n");
}

// Compress runs of consecutive turn numbers into "first-last" form so a
// 25-occurrence error spanning turns 96-120 reads as `96-120` instead of
// hogging a line. Mixed sparse + run sequences come out as
// `1, 4, 96-120`.
function compressTurns(turns) {
	if (turns.length === 0) return "";
	const sorted = [...turns].toSorted((a, b) => a - b);
	const out = [];
	let runStart = sorted[0];
	let prev = sorted[0];
	for (let i = 1; i <= sorted.length; i++) {
		const cur = sorted[i];
		if (cur === prev + 1) {
			prev = cur;
			continue;
		}
		out.push(runStart === prev ? `${runStart}` : `${runStart}-${prev}`);
		runStart = cur;
		prev = cur;
	}
	return out.join(", ");
}

function renderErrorsMarkdown(scopeName, allErrors, summary) {
	const lines = [];
	lines.push(`# Errors: ${scopeName}`);
	lines.push("");
	if (allErrors.length === 0) {
		lines.push("No errors recorded.");
		return lines.join("\n");
	}
	lines.push(
		`${summary.total} errors across ${Object.keys(summary.byTask).length} task(s) — ${summary.strikes} strike, ${summary.soft} soft.`,
	);
	lines.push("");
	lines.push("## Counts by outcome");
	lines.push("");
	for (const [oc, n] of Object.entries(summary.byOutcome)) {
		lines.push(`- \`${oc}\` × ${n}`);
	}
	lines.push("");
	lines.push("## Counts by task");
	lines.push("");
	for (const [task, n] of Object.entries(summary.byTask)) {
		lines.push(`- \`${task}\` × ${n}`);
	}
	lines.push("");
	lines.push("## Top signatures");
	lines.push("");
	for (const g of summary.topSignatures) {
		lines.push(
			`### ×${g.count} — \`${g.outcome ?? "—"}\`${g.sourcePathPattern ? ` @ \`${g.sourcePathPattern}\`` : ""}`,
		);
		lines.push("");
		lines.push(`turns: ${compressTurns(g.turns)}`);
		if (g.tasks.length > 1) {
			lines.push(`tasks: ${g.tasks.map((t) => `\`${t}\``).join(", ")}`);
		}
		lines.push("");
		lines.push("error body:");
		lines.push("");
		lines.push("```");
		lines.push(g.exemplar.body);
		lines.push("```");
		if (g.exemplar.sourceAction) {
			const sa = g.exemplar.sourceAction;
			lines.push("");
			lines.push(
				`source action (\`${sa.action}\`${sa.targetPath ? ` → \`${sa.targetPath}\`` : ""}):`,
			);
			lines.push("");
			lines.push("```");
			lines.push(sa.body);
			lines.push("```");
		}
		lines.push("");
	}
	lines.push("## Chronological");
	lines.push("");
	const byTask = new Map();
	for (const er of allErrors) {
		const k = er.run.task + (er.run.alias ? `/${er.run.alias}` : "");
		if (!byTask.has(k)) byTask.set(k, []);
		byTask.get(k).push(er);
	}
	for (const [taskKey, errs] of byTask) {
		lines.push(`### ${taskKey}`);
		lines.push("");
		for (const er of errs) {
			const stateTag = er.soft ? "soft" : "strike";
			const oc = er.outcome ?? "—";
			const src = er.sourcePath ? ` @ \`${er.sourcePath}\`` : "";
			lines.push(`- T${er.turn} \`${oc}\`/${stateTag}${src}`);
			lines.push("");
			lines.push(indentBlock(er.body, "  > "));
			lines.push("");
			if (er.sourceAction) {
				const sa = er.sourceAction;
				lines.push(
					`  source: \`${sa.action}\`${sa.targetPath ? ` → \`${sa.targetPath}\`` : ""}`,
				);
				lines.push("");
				lines.push(indentBlock(sa.body, "  > "));
				lines.push("");
			}
		}
	}
	return lines.join("\n");
}

function writeErrorsArtifacts(outDir, scopeName, allErrors) {
	const summary = aggregateErrors(allErrors);
	writeFileSync(
		join(outDir, "errors.md"),
		`${renderErrorsMarkdown(scopeName, allErrors, summary)}\n`,
	);
	writeFileSync(
		join(outDir, "errors.json"),
		`${JSON.stringify({ scope: scopeName, summary, errors: allErrors }, null, 2)}\n`,
	);
}

// Synthesize a run-summary from the DB for runs that lack the harbor-side
// rummy.txt `__RUMMY_RUN_SUMMARY__` line (e2e tests, primarily). Token
// counts come from the turns table; status from the runs table.
function synthSummary(run, turnsRows) {
	let prompt = 0;
	let completion = 0;
	let cached = 0;
	let reasoning = 0;
	for (const t of turnsRows) {
		prompt += t.prompt_tokens || 0;
		completion += t.completion_tokens || 0;
		cached += t.cached_tokens || 0;
		reasoning += t.reasoning_tokens || 0;
	}
	return {
		status: run.status ?? null,
		turns: turnsRows.length,
		tokens: { prompt, completion, cached, reasoning },
		cost: 0,
		wallSeconds: null,
	};
}

function processTask(taskDir, taskNameOverride = null) {
	const taskName =
		taskNameOverride ??
		taskDir
			.replace(/\/+$/, "")
			.split("/")
			.pop()
			.replace(/\.digest$/, "")
			.replace(/__[A-Za-z0-9]+$/, "");
	const rummyDb = findAgentDb(taskDir);
	if (rummyDb == null) {
		closeSync(openSync(join(taskDir, "digest_skipped"), "w"));
		return [
			{
				task: taskName,
				dir: taskDir,
				reward: readReward(taskDir),
				status: null,
				turns: 0,
				tokens: null,
				cost: null,
				wallSeconds: null,
				markers: ["exfil_fail"],
				prompt: null,
				turnRows: [],
				errors: [],
			},
		];
	}

	const reward = readReward(taskDir);
	const harborSummary = readRunSummary(taskDir);
	const perRun = readDb(rummyDb);

	// Tbench DBs hold one run per task container; e2e TestDb DBs hold many
	// (one per `it()` block). Single-run task dirs keep the legacy layout
	// (digest.md alongside agent/); multi-run task dirs nest per-run output
	// at <task>/<alias>/.
	const multiRun = perRun.length > 1;
	const out = [];
	for (const { run, turns, logEntries, packetEntries, prompt } of perRun) {
		const turnRows = buildTurns(turns, logEntries);
		const turnPackets = groupPacketsByTurn(packetEntries);
		const runSummary =
			!multiRun && harborSummary ? harborSummary : synthSummary(run, turns);
		const markers = classifyMarkers(reward, runSummary, turnRows);
		const runName = multiRun ? `${taskName}/${run.alias}` : taskName;
		const outDir = multiRun ? join(taskDir, run.alias) : taskDir;
		mkdirSync(outDir, { recursive: true });

		const waterfall = renderWaterfall(
			runName,
			prompt,
			runSummary,
			reward,
			turnRows,
			markers,
		);
		writeFileSync(join(outDir, "digest.md"), `${waterfall}\n`);
		writeFileSync(
			join(outDir, "reasoning.md"),
			`${renderReasoning(runName, turnRows)}\n`,
		);
		writeFileSync(
			join(outDir, "packets.md"),
			`${renderPackets(runName, turnPackets)}\n`,
		);
		const digest = digestJson({
			taskName: runName,
			taskDir: outDir,
			prompt,
			runSummary,
			reward,
			turnRows,
			markers,
		});
		digest.errors = collectErrors(turnRows, logEntries, {
			task: taskName,
			alias: multiRun ? run.alias : null,
		});
		writeFileSync(
			join(outDir, "digest.json"),
			`${JSON.stringify(digest, null, 2)}\n`,
		);
		out.push(digest);
	}
	return out;
}

function csvEscape(s) {
	if (s == null) return "";
	const str = String(s);
	if (/[,"\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
	return str;
}

function writeIndex(sweepDir, digests) {
	const header = [
		"task",
		"reward",
		"status",
		"turns",
		"prompt_tokens",
		"completion_tokens",
		"cached_tokens",
		"cost",
		"wall_seconds",
		"markers",
	].join(",");
	const rows = digests
		.toSorted((a, b) => (a.task ?? "").localeCompare(b.task ?? ""))
		.map((d) =>
			[
				csvEscape(d.task),
				csvEscape(d.reward),
				csvEscape(d.status),
				csvEscape(d.turns),
				csvEscape(d.tokens?.prompt ?? ""),
				csvEscape(d.tokens?.completion ?? ""),
				csvEscape(d.tokens?.cached ?? ""),
				csvEscape(d.cost),
				csvEscape(d.wallSeconds),
				csvEscape(d.markers.join(";")),
			].join(","),
		);
	writeFileSync(join(sweepDir, "index.csv"), `${header}\n${rows.join("\n")}\n`);
}

// CLI: first positional arg is a `.db` file, a task dir, or a sweep dir.
// Second positional arg (bare-DB mode only) selects which run becomes
// the "featured" run promoted to test/digest/ — exact or substring
// match against run.alias. Default: the most-recent (highest-id) run.
// With no arg, default to the latest sweep under test/tbench/results.
const target = process.argv[2];
const runSelector = process.argv[3] ?? null;
let entry;
if (target) {
	entry = target.startsWith("/") ? target : join(process.cwd(), target);
} else {
	const sweeps = readdirSync(RESULTS_DIR)
		.filter((d) => statSync(join(RESULTS_DIR, d)).isDirectory())
		.sort();
	if (sweeps.length === 0) {
		console.error("no sweep dir found");
		process.exit(2);
	}
	entry = join(RESULTS_DIR, sweeps[sweeps.length - 1]);
}

if (!existsSync(entry)) {
	console.error(`not found: ${entry}`);
	process.exit(2);
}

// Bare-DB invocation: `node bin/digest.js /path/to/rummy.db`. The full
// pile (per-alias subdirs for multi-run DBs) lands in /tmp/rummy_digest/.
// We synthesize a task dir there so processTask's path discipline
// (agent/rummy.db, reward.txt-optional, rummy.txt-optional) keeps
// holding. After processTask runs, PUBLIC_DIR gets a flat copy of the
// most recent run's artifacts (see end of file).
let bareDbName = null;
if (statSync(entry).isFile() && /\.db$/.test(entry)) {
	const { rmSync, linkSync, copyFileSync: cp, existsSync: ex } = await import(
		"node:fs"
	);
	bareDbName = entry.split("/").pop().replace(/\.db$/, "");
	rmSync(PILE_DIR, { recursive: true, force: true });
	mkdirSync(join(PILE_DIR, "agent"), { recursive: true });
	const linkedDb = join(PILE_DIR, "agent", "rummy.db");
	// Hard-link the main DB plus -wal/-shm siblings if present. The DB
	// is in WAL mode; without the -wal file the reader sees only
	// checkpointed state and misses recent writes (turns, run.status
	// updates, log entries). Hard-link is cheap and keeps reads off
	// the live DB if any; fall back to copy on cross-device or
	// filesystem-restricted setups.
	const linkOrCopy = (src, dst) => {
		try {
			linkSync(src, dst);
		} catch {
			cp(src, dst);
		}
	};
	linkOrCopy(entry, linkedDb);
	for (const ext of ["-wal", "-shm"]) {
		const src = `${entry}${ext}`;
		if (ex(src)) linkOrCopy(src, `${linkedDb}${ext}`);
	}
	entry = PILE_DIR;
}

if (isTaskDir(entry)) {
	const digests = processTask(entry, bareDbName);
	const allErrors = digests.flatMap((d) => d.errors ?? []);
	writeErrorsArtifacts(entry, bareDbName ?? entry.split("/").pop(), allErrors);
	for (const d of digests) {
		console.log(`wrote digest for ${d.task}: ${d.markers.join(", ")}`);
	}
	console.log(
		`wrote errors.md + errors.json (${allErrors.length} errors) → ${entry}/`,
	);

	// Bare-DB mode: copy the most-recent run's flat artifacts into
	// PUBLIC_DIR (test/digest/) so a human can `cat test/digest/digest.md`
	// without spelunking. Pile of all runs stays in PILE_DIR. For single-
	// run DBs this is just "the digest." For multi-run DBs (e2e TestDb,
	// LME) this is the highest-id run; pick a different one out of the
	// pile if you want it.
	if (bareDbName) {
		const { rmSync, copyFileSync: cp } = await import("node:fs");
		rmSync(PUBLIC_DIR, { recursive: true, force: true });
		mkdirSync(PUBLIC_DIR, { recursive: true });
		let featured = digests[digests.length - 1];
		if (runSelector) {
			const matches = digests.filter((d) =>
				d.task.includes(runSelector),
			);
			if (matches.length === 0) {
				console.error(
					`run selector "${runSelector}" matched no run in this DB. ` +
						`Available: ${digests.map((d) => d.task).join(", ")}`,
				);
				process.exit(2);
			}
			if (matches.length > 1) {
				console.error(
					`run selector "${runSelector}" matched ${matches.length} runs: ` +
						matches.map((d) => d.task).join(", "),
				);
				process.exit(2);
			}
			featured = matches[0];
		}
		for (const f of ["digest.md", "reasoning.md", "packets.md", "digest.json"]) {
			const src = join(featured.dir, f);
			if (existsSync(src)) cp(src, join(PUBLIC_DIR, f));
		}
		for (const f of ["errors.md", "errors.json"]) {
			const src = join(entry, f);
			if (existsSync(src)) cp(src, join(PUBLIC_DIR, f));
		}
		console.log(
			`featured run (${featured.task}) → ${PUBLIC_DIR}/digest.md`,
		);
	}
} else {
	const taskDirs = findTaskDirs(entry);
	if (taskDirs.length === 0) {
		console.error(`no task dirs (with agent/rummy*.db) under ${entry}`);
		process.exit(2);
	}
	const digests = [];
	for (const td of taskDirs) {
		try {
			digests.push(...processTask(td));
		} catch (err) {
			console.error(`! ${relative(entry, td)}: ${err.message}`);
			digests.push({
				task: td
					.split("/")
					.pop()
					.replace(/__[A-Za-z0-9]+$/, ""),
				dir: td,
				reward: null,
				status: null,
				turns: 0,
				tokens: null,
				cost: null,
				wallSeconds: null,
				markers: ["digest_failed"],
				prompt: null,
				turnRows: [],
				errors: [],
			});
		}
	}
	writeIndex(entry, digests);
	const allErrors = digests.flatMap((d) => d.errors ?? []);
	writeErrorsArtifacts(entry, entry.split("/").pop(), allErrors);
	console.log(
		`wrote ${digests.length} digests + index.csv + errors.md (${allErrors.length} errors) → ${entry}/`,
	);
}

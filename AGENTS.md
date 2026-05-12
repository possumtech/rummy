# AGENTS: Lessons, Practices, Todos

> **SESSION BOOTSTRAP — READ ME FIRST.** Cross-session ground truth.
> Before touching code: read the standing rules, the "Now" block, and
> any open "Ongoing Development Conversation" entries. Cross-reference
> SPEC.md §0 for the contract and PLUGINS.md §7 for the events/filters
> surface. **This file is not a trophy room** — store lessons,
> practices, and todos. Achievement narrative belongs in git history.

> **Standing rules that override anything else:**
> - **No fallbacks outside `src/lib/hedberg/*` and `src/agent/XmlParser.js`.**
>   Not `|| 0`, not `?? null`, not `|| ""`. Boundaries validate;
>   interiors crash on contract violation. `biome/no-fallbacks.grit`
>   enforces — if it complains, fix the contract, not the rule.
> - **Every `createEvent` / `createFilter` in `Hooks.js` is a plugin
>   extension point and stays.** Zero current subscribers does not
>   mean "delete" — extensibility is the keystone architectural
>   promise. Adding events where core fires an unannounced phase
>   is encouraged.
> - **AGENTS.md isn't a trophy room.** When a phase lands, its
>   detail collapses to one line. Lessons survive; trivia dies.
>   Never remove a standing rule.
> - **The user is right until the DB proves otherwise.** When a
>   symptom gets reported, read `rummy_dev.db` first, don't guess,
>   don't blame the environment, don't defer to the next demo.
> - **Read `rummy_dev.db` via the digest, not via raw SQL.** Run
>   `npm run dev:digest` (writes `digest.md`, `digest.json`,
>   `reasoning.md` to `/tmp/rummy_dev_digest/`) and read the curated
>   artifacts. Direct SQL spelunking encourages half-engaged review
>   and hallucinated patterns. The same digest pipeline that powers
>   tbench analysis works on the dev DB; use it.
> - **Integration and e2e tests are 1:1 with SPEC.md's snake_case
>   anchor system.** Every SPEC.md heading carries an explicit
>   `{#snake_case_id}` anchor. Every anchor has at least one
>   `@snake_case_id` reference in `test/integration/` or
>   `test/e2e/`. Every test in those dirs is attributed to at least
>   one `@`-reference. No integration or e2e test exists outside
>   this system; no SPEC anchor exists without a test anchoring
>   it. See SPEC.md section "Spec-Anchored Testing". Enforced by
>   `npm run test:spec`. Numeric `§X.Y` references are dead — use
>   snake_case anchors that don't churn when sections move.
> - **AGENTS.md is the project memory scratchpad.** Never store
>   project-scoped decisions, plans, or state in Claude internal
>   memory (`~/.claude/projects/...`). Project-specific facts live
>   here where everyone can see them and the next session can read
>   them. Internal memory is for user-wide preferences only.
> - **Benchmark integrity.** rummy is a general agent that happens
>   to perform well at whatever task it's pointed at — never tuned
>   for a specific benchmark. No benchmark-specific prompts,
>   heuristics, or tools. Pre-flight task selection must be a
>   representative cross-section, never cherry-picked for likely
>   passes. Bridge adapters (e.g. `harbor`'s `rummy.py`) stay
>   vanilla — protocol bridges, not benchmark boosters.

> **Instructions discipline (when touching `instructions-system.md`
> or `instructions-user.md`):**
> - **Brief.** Every token is paid every turn. Cut before expanding.
> - **Show, don't tell.** A three-line worked example beats ten
>   lines of "you must / you should".
> - **Cross-tool trade-offs.** The model's context is one zero-sum
>   pool across `<get>`, `<set>`, `<rm>`, `<search>`, `<update>`,
>   `<sh>`, `<ask_user>`. A rule that helps one can starve another.
> - **System-stable, user-static.** `instructions-system.md` (with
>   `[%TOOLS%]` / `[%TOOLDOCS%]` expansions) is the cacheable system
>   prompt — must stay byte-identical across turns within a run.
>   `instructions-user.md` renders as `<instructions>` at user
>   priority 165 (sandwich tail) — same bytes every turn, no phase
>   keying.

> **Guiding principles (enshrined):**
>
> "Is there a rummy way to do this?" Every `<tag>` the model sees is
> a plugin. Every scheme is registered by its owner. Every piece of
> data exists as an entry or a column. No exceptions without docs.
>
> **Everything is an entry.** Files, tool calls, streaming output,
> plans, unknowns, sub-agents — all entries. `<get>`/`<set>` is the
> universal grammar. (SPEC §0.1)
>
> **"Model behavior" is never an acceptable explanation for a test
> failure.** When a model misbehaves, the system failed — suboptimal
> context, poorly designed conditions, insufficient reinforcement.
> Every failure is a system bug until proven otherwise.
>
> **Reference + feedback over broadcast.** Steer the model through
> three channels in priority order: (1) tooldocs at the decision
> point, (2) error:// entries for dynamic feedback, (3) instructions
> for genuinely cross-cutting identity. System instructions pay context
> every turn; prefer the other two channels first.

## Documentation placement (where each kind of doc belongs)

| Kind | Lives in |
|---|---|
| Non-obvious *why* / hack warning at the site | One-line `//` comment in source, nowhere else |
| *What* the code does | Nowhere — rename until the identifier says it |
| Contract / promised behavior of the system | `SPEC.md`, anchor-tagged so tests can `@`-reference it |
| Plugin's behavior, internal design, helper rationale | `src/plugins/<name>/README.md` |
| Plugin extension surface (events / filters) | `PLUGINS.md` §7 |
| Model-facing guidance at the decision point | `src/plugins/<name>/<name>Doc.js` (tooldoc) |
| Cross-cutting model identity / global rules | `instructions-system.md` (sacred — touched only on explicit approval) |
| Per-turn imperative reminders | `instructions-user.md` (sacred) |
| Project state, standing rules, in-flight threads | `AGENTS.md` |

Per-comment decision flow when sweeping source: says *what* → delete;
says *spec* → move to `SPEC.md` / `PLUGINS.md` / plugin README and
delete; warns about a hack/gotcha → trim to one line; duplicates the
constant name → delete.

---

## Sweep analysis (tbench + e2e + integration digests)

Both `npm run test:tbench:*` and `npm run test:e2e` auto-emit a
deterministic analysis layer at the end of the run (driven by
`bin/digest.js`). Re-runnable with `node bin/digest.js <dir>` or
`node bin/digest.js <path/to/rummy.db>` — first-order forensic tool,
not bench-specific. Read-only derivative of the rummy.db /
rummy.txt / verifier-reward sources, idempotent.

**Where to look:**
- `test/tbench/results/<sweep>/...` for tbench (one run per task dir)
- `/tmp/rummy_test_diag/<suite>_<ts>/...` for e2e/integration (one
  TestDb per suite; many runs per DB; per-run digests at
  `<task>/<alias>/`)

The digest tool detects single-run vs multi-run DBs automatically
and emits the appropriate layout — single-run (tbench) writes
`digest.md` directly in the task dir; multi-run (e2e) nests at
`<task>/<alias>/`.

**Per-task artifacts** (in each task dir, alongside `agent/`,
`verifier/`):

- `digest.md` — header (status / reward / turns / cost / tokens) +
  marker list + per-turn waterfall (`T<N>: <status> "<update body>"`
  with indented `  ← <action> <target>` emission lines and
  `  ✗ error:` lines). Scan target: get the shape of a run in one
  screen. Failed emissions tagged `✗ [<outcome>]`.
- `digest.json` — same data, machine-queryable. Use for `jq` /
  cross-task aggregation.
- `reasoning.md` — per-turn `reasoning_content` bracketed by
  `## Turn <N>` headers. Drill-down anchor: when the waterfall
  raises a question (e.g., "what was the reasoning on turn 8?"),
  grep `^## Turn 8` here and read the body.
- `digest_skipped` — empty file, written when `agent/rummy.db` is
  absent (exfil-fail). Tells future passes "we tried, no data."

**Sweep-wide artifacts** (at sweep root):

- `index.csv` — one row per task: `task,reward,status,turns,
  prompt_tokens,completion_tokens,cached_tokens,cost,wall_seconds,
  markers`. Standard triage front door.
- `errors.md` / `errors.json` — cross-task error report. Header
  counts by outcome, by task. Top signatures (recurring failures
  grouped by `outcome :: source-path-pattern :: body-prefix`) with
  compressed turn-lists and the originating action body for each.
  Per-task chronological tail with full body + source body for
  every error. When `digest.js` is invoked on a single task dir
  these land alongside the per-task artifacts instead of at sweep
  root. Use this to surface recurring patterns the per-task
  waterfall truncates (e.g., gemma26's 44× SEARCH/REPLACE retry
  against `tests/runner_test.go` turns 96-224).

**Marker taxonomy** (auto-classified, semicolon-joined in `markers`
column):

- `passed` — `reward=1`.
- `claim_success_verifier_fail` — `reward=0` AND `status=200`. The
  dominant failure pattern in the 2026-05-01 sweep.
- `max_loop_turns` — `status=499` AND turn count near
  `RUMMY_MAX_LOOP_TURNS`.
- `strike_abandon` — `status=499` AND an error body starts with
  `Abandoned after`.
- `reasoning_runaway_t<N>` — turn N had ≥8000 chars of
  `reasoning_content` AND zero productive emissions. Single-turn
  signal; the turn number tags which one.
- `parser_warning` — error body starts with `Unclosed` or contains
  `Tool call limit`.
- `context_overflow` — `status=413`.
- `dispatch_500` — `status=500`.
- `exfil_fail` — no `__RUMMY_RUN_SUMMARY__` line in `rummy.txt` and
  no rummy.db. Run died before drain; container-side post-mortem
  needed.
- `digest_failed` — digest.js threw on this task. Investigate.

**Standard triage queries** (assume `cd <sweep-dir>` first):

- All claim-success/verifier-fails:
  `awk -F, '$2==0 && $3==200' index.csv`
- All runaway turns (with which turn):
  `awk -F, '/reasoning_runaway/' index.csv`
- Open one task's digest: `cat <task-dir>/digest.md`
- Reasoning on a specific turn:
  `awk '/^## Turn 8$/,/^## Turn /' <task-dir>/reasoning.md`
- Cross-task error report (preferred): read `errors.md` at sweep root.
- Cross-task error grep (fallback for ad-hoc digging):
  `grep -rh "✗ error:" */digest.md | sort | uniq -c | sort -rn`

**Output-dir control.** `test/tbench/runner.js` accepts `--out
<path>` (CLI) or `RUMMY_TBENCH_OUT_DIR` (env) to override the
default timestamped path under `test/tbench/results/`. Used for
parallel runs landing in named dirs:
`npm run test:tbench:gemma -- --out audit/gemma_1` and
`npm run test:tbench:grok -- --out audit/grok_1` in separate
shells. Both write their own digests and indexes.

## Now

**The contract is lean.** The engine enforces three things via the
strike system: budget overflow, repetition (cycle detection), and
per-turn `<update>` inclusion. Plus the ask-mode shield (run-mode
permission, separate concern). Everything else is the model's
responsibility, taught via the model-facing prose.

Implementation, tests, SPEC.md, AGENTS.md aligned. Lint clean.
880 unit, 245 integration, 31/31 e2e (sandwich run), 101 spec
anchors × 44 test files.

**Packet ordering — locked in (sandwich):** user message is
`<persona>` (10) → `<log>` (50) → `<turn>` (90) →
`<instructions>` (165). The system message holds the cacheable
prefix: `assembleSystemBase` (50), `assembleSystemToolDocs` (100),
`<index>` from known (200). The sandwich exists because front-
loaded ordering (instructions first for max cache) regressed
`act_no_completion` in e2e: the model lost terminal-`<update>`
discipline when "YOU MUST update with status=200" was buried 3K
tokens before the action site. Sandwich restored 31/31 pass at
the cost of cache hit rate. **Why:** recency at the action site
beats cache savings when the action depends on remembering a
rule. **How to apply:** when adding a new `assembly.user` filter,
slot it by purpose — static reference goes early for cache;
per-turn discipline reminders go near `<instructions>` for
recency; live accounting goes after `<turn>`.

**Bench environment.** Local llama-server build `b199-82209ef`
(Blackwell-targeted CUDA) on RTX 5070 Ti / 16 GB VRAM / single
slot, `n_ctx=65536`. Loaded model: **Gemma 4 26B-A4B-It** IQ4_XS,
~168 t/s generation. Sampler: temp=0.1, reasoning-budget=4096.
**Cache=0 is structural, not a bug** — Gemma 4 uses sliding-window
attention; llama.cpp's prompt-cache path doesn't support hybrid
KV state (PR #13194). Server logs `cache_reuse is not supported by
this context` at boot; every request re-processes the full prompt.
Don't treat cache rate as harness-side signal on this model.

**Open items unblocked by the cleanup:**

- Pivot terminal-bench from grok to local gemma.
- Tooldoc example weight measurement (CC-13).
- `unknown://env/...` example proposal — sacred-prompt territory; awaiting user direction.
- Sudden-death turn warning — calibration-relevant once baseline numbers exist.
- ProgramBench integration (see Open Items).

### Architectural exceptions (keep, document)

These are deliberate paradigm deviations with real justification.
None should be refactored; all should be named in PLUGINS.md so
they aren't mistaken for ceremony by the next session.

- **`hooks.update.resolve`** — single-owner with synchronous
  return value. Caller needs `{ summaryText, updateText }` back;
  events emit but don't return; only the update plugin knows
  terminal-vs-continuation status semantics.
- **`Entries.scheme(path)` / `Entries.normalizePath(path)` static
  imports across plugins** — pure utility statics. Routing through
  hooks would be ceremony for zero capability gain.
- **`countTokens`, `stateToStatus` utility imports** — same shape:
  stateless utility functions, fine to import.
- **CLI / RPC importing `ProjectAgent` / `RummyContext` directly**
  — these are *transport* plugins, not action plugins. Their job
  is to bridge external interfaces to the agent; the import is
  what makes them transports.

### Refactor candidates (deferred)

- **`XmlParser` extraction → parser plugin.** With a generic
  `parser.parse` hook in TurnExecutor. Multi-format input becomes
  possible (native tool-calls, JSON shapes, thinking-channel
  formats) without forking core. Drive by "do we actually need
  multi-format input?" rather than by seam pressure.
- **`file/` plugin reached by 3 other plugins** (rpc, set, cli).
  Cross-plugin direct imports, classification unclear without
  reading the file plugin's role.

### Spirit clause

Reduce complexity by manifesting ideals already described, not by
extending the architecture with new features. Each move should
make the codebase smaller and the contract crisper. If a proposed
extraction adds a hop without separating concerns, it's ceremony
— drop it.

## Index/Archive Refactor (LANDED)

Two-state visibility (`indexed` / `archived`). Model owns every
transition; engine never auto-promotes/demotes/revives. Grammar:
`<set archive/>` / `<set index/>` flips state; `<get>` is pure
read; `<rm>` is permanent delete. Phase 3 file freshness ships
SEARCH/REPLACE injection from disk diffs. Budget rescue archives
t-1 only via synthesized `<get manifest/>`; no cascade beyond.
See SPEC.md anchors `state_visibility`, `file_freshness`,
`budget_rescue`.

## Open Items

### Budget cascade: align implementation with documented behavior

Surfaced 2026-05-11 by `test/e2e/demo_essay.test.js` (Rumsfeld
prompt). Model fetched `en.wikipedia.org/wiki/Donald_Rumsfeld` on
T4 (~76K tokens); T5-T7 all died with `LLM context exceeded`;
strike-streak fired as "Loop detected" → terminal 499. Digest:
`test/digest/digest.md`. Three engine layers compounded:

1. Pre-flight gate uses prior-turn's `context_tokens` as baseline.
   Doesn't reflect new fat content authored *during* the prior
   turn. Today's grinder thinks the packet is fine and never fires.
2. Pre-flight rejection is best-effort: when slim can't fit, the
   over-budget packet is dispatched anyway. Provider returns 400.
3. `ContextExceededError` catch logs 413 and ends the turn. The
   fat entry is untouched. Next turn assembles identically and
   fails identically. Three failures → cycle-detection
   misclassifies as repetition.

**Why:** Each layer was designed to handle this scenario alone;
each is broken. Any single fix would have saved the run.

**TDD plan: write the failing tests first, then the engine fix
each one demands.** Existing budget tests at
`test/integration/budget_math.test.js` and `:cascade` all pass
because they pass `lastPromptTokens: 0`, dodging the broken path.
The bug only manifests when `lastPromptTokens > 0` AND the prior
count underestimates the current packet.

### Tests-first (write, watch fail, then fix)

| # | File | Test name | What it pins | Expected failure today |
|---|---|---|---|---|
| T1 | new `test/integration/budget_preflight_uses_actual_packet.test.js` | "grinder gates on assembled packet, not prior `context_tokens`" | Seed prior `context_tokens=5000`; build current messages totaling > ceiling; call `enforce({lastPromptTokens: 5000})`; assert grinder reclaims fat replays. | Current `#check` short-circuits on `lastPromptTokens > 0` → returns `ok: true` → no reclamation. |
| T2 | new `test/integration/budget_hard_413_shortcircuits_dispatch.test.js` | "over-budget packet that can't be slimmed never reaches the LLM" | Seed an over-budget packet with no fat replays; invoke full `turn.beforeDispatch` chain; mock provider; assert provider was not called and a hard 413 surfaced. | Caller doesn't check `result.ok`; dispatches regardless. |
| T3 | new `test/e2e/budget_recovery.test.js` | "context-exceeded triggers slim-and-retry, terminal 413 on second failure" | Mock provider: first call throws `ContextExceededError`, second returns normal completion → run reaches 200. Variant: both calls throw → run exits at terminal **413**, not 499 "Loop detected." | No retry path exists; three throws roll into cycle-detection. |
| T4 | new `test/integration/budget_413_not_loop_detected.test.js` | "repeated 413 doesn't misclassify as repetition strike" | Inject three consecutive 413 errors; assert verdict resolves to terminal 413, not 499. | Strike-streak treats them as cycle. |

### Engine fixes (one per failing test)

| # | File | Change | Makes which test pass |
|---|---|---|---|
| E1 | `src/plugins/budget/budget.js:174-185` | `#check` always `measureMessages(messages)`. Drop the `lastPromptTokens > 0 ? ...` ternary for gate decisions. `lastPromptTokens` stays where it's used for `max_tokens` derivation (`src/agent/TurnExecutor.js:167`). | T1 |
| E2 | `src/plugins/budget/budget.js:316-324` (`#failed`) + the `turn.beforeDispatch` caller in `src/agent/TurnExecutor.js` | Hard 413 must short-circuit dispatch. Caller checks `result.ok` and aborts. | T2 |
| E3 | `src/agent/TurnExecutor.js:170-189` | On `ContextExceededError`: invoke `Budget#enforce` aggressively (reclaim ALL prior `<get>`/`<set>` log bodies, not just t-1), retry once. If second attempt also fails, exit run with terminal **413**. | T3 |
| E4 | cycle-detection plugin (locate) | Treat 413 context-exceeded as structural overflow, not repetition. | T4 |

### Doc + spec alignment (after fixes pass)

| # | File | Change |
|---|---|---|
| D1 | `SPEC.md:1098-1101` + `SPEC.md:1141-1147` | Rewrite: "measure the assembled messages" instead of "use prior-turn `context_tokens`." Note: `lastPromptTokens` retained ONLY for `max_tokens` derivation. |
| D2 | `SPEC.md#budget_enforcement` anchors | Add anchors so T1-T4 carry `@budget_enforcement` references. Update `npm run test:spec` coverage. |
| D3 | `test/e2e/demo_essay.test.js` | Annotate: ingest a Wikipedia-sized page and recover. Becomes the integration witness for E1+E3. |

**Order:** T1 → E1 → T2 → E2 → T3 → E3 → T4 → E4 → D1 → D2 → D3.
Each test added → run → confirm red → apply engine fix → confirm
green → next test. Standard red-green-refactor.

**Phase 3 (model-side hardening, gated on engine green):**
strengthen `rummy.web/main/src/search.md:11` and add a MUST in
`src/plugins/get/getDoc.md` tying `tokens` vs `tokensFree`.

**Phase 3 (model-side hardening, gated on Phase 1):** strengthen
`rummy.web/main/src/search.md:11` and add a MUST in
`src/plugins/get/getDoc.md` tying `tokens` vs `tokensFree`.
Skipped for now — won't help if the engine doesn't enforce, and
adds packet weight every turn.

### Scheme-write permission + change-render unification (LANDED — superseded by next section)

Surfaced 2026-05-11 by `test/programbench` grok run on
`tomnomnom__gron.88a6234`. Grok declared status=200 in 4 turns,
$0.04, but eval returned `compile_failed` — the workspace contained
only the original docs. Model had written `<set path="repo://compile.sh">`
(silent success into entries table; never hit disk) instead of bare
workspace paths. After fixing plan-template inertia
(`src/plugins/persona/default.md:5` directive to adapt plan to prompt),
a second run with 26 turns / 219K tokens / $0.22 ALSO failed eval —
same `repo://compile.sh` confusion, plus the model echoing the
"MANIFEST set path=... 0 matched" response back as `<<NEW>>` body.
Root causes: (a) `repo://` scheme registered with no `writable_by`
restriction, so model writes silently succeed into the entries
table; (b) unknown schemes have the same silent-success fallback
in `Entries.js#schemeRules`; (c) `repo://manifest` was frozen at
T0, so workspace mutation went invisible across the run.

Secondary discovery while designing the fix: today's log body has
**two grammars** for "what changed." Model `<set>` log entries
store `body = attrs.inner` (verbatim emission) while
FileScanner-injected entries store `body = generateSearchReplaceBody(...)`
(engine-synthesized SEARCH/REPLACE). `attributes.patch` carries
udiff in both cases. This is a documented split (`set.js:319-321`,
`372-374`) but it means the model reads two formats when scanning
the log for changes. Unify on udiff body, preserve verbatim
emission in `attributes.emission` for forensic just-in-case.

**Tests-first**

| # | File | Test name | What it pins | Expected failure today |
|---|---|---|---|---|
| T1 | new `test/integration/scheme_write_permissions.test.js` | "model write to unregistered scheme raises PermissionError" | `<set path="bogus://x">` from model writer → PermissionError → error.log entry. | Falls back to `["model", "plugin"]` writers → silent success. |
| T2 | same file | "model write to `repo://` scheme raises PermissionError" | After registering `repo` with `writable_by: ["plugin"]`, model `<set path="repo://compile.sh">` → PermissionError. Plugin write to `repo://manifest` still succeeds. | No `writable_by` on `repo` → model writes succeed. |
| T3 | new `test/integration/repo_manifest_refresh.test.js` | "manifest refreshes when workspace files change" | Scan a project, model creates a new file via `<set path="foo.txt">`, scan again, assert `repo://manifest` body includes `foo.txt`. | One-shot guard `existingManifest.length === 0` prevents rewrite. |
| T4 | new `test/integration/log_body_is_udiff.test.js` | "model `<set>` log body is udiff, `attributes.emission` preserves verbatim" | Model emits SEARCH/REPLACE on a known entry; assert log body starts with `===` (udiff banner) and `attributes.emission` equals the original `attrs.inner`. | Today `body = attrs.inner`; no `attributes.emission`. |
| T5 | same file | "FileScanner-injected external change log body is udiff" | Mutate a project file on disk between scans; assert injected log body is udiff (not SEARCH/REPLACE), `attributes.external = true`, `attributes.patch` absent. | Today `body = generateSearchReplaceBody(...)`; `attributes.patch` present. |

**Engine fixes (one per failing test)**

| # | File | Change | Makes which test pass |
|---|---|---|---|
| E1 | `src/agent/Entries.js#schemeRules` | When scheme is unknown (not in `this.#schemes`) AND `writer === "model"`, throw `PermissionError`. Plugin writes still allowed (engine surfaces like the `repo` plugin need to register schemes still, but unknown-from-model is hard fail). | T1 |
| E2 | `rummy.repo/main/src/rummy.repo.js:14` | Add `writable_by: ["plugin"]` to `repo` scheme registration. | T2 |
| E3 | `rummy.repo/main/src/FileScanner.js:269-274` | Drop the one-shot `if (existingManifest.length === 0)` guard. Manifest rewrites every scan; FileScanner's existing mtime/hash skip on unchanged files keeps the work bounded. | T3 |
| E4 | `src/plugins/set/set.js:327-347` (file proposed) + `381-407` (scheme write) | Set `body: generatePatch(target, oldContent, newContent)`; move `attrs.inner` into `attributes.emission`; drop `attributes.patch` (body is the patch). Keep `attributes.patched` (file `#materializeFile` reads it). | T4 |
| E5 | `rummy.repo/main/src/FileScanner.js:142-177` | Replace `generateSearchReplaceBody(before, content)` with `generatePatch(relPath, before, content)`; drop `attributes.patch`. Remove `generateSearchReplaceBody` from `src/lib/hedberg/matcher.js` + `hedberg.js` exports + tests. | T5 |

**Doc + spec alignment (after fixes pass)**

| # | File | Change |
|---|---|---|
| D1 | `SPEC.md` (search for `repo://manifest` + `attributes.patch`) | Update: manifest now live (refreshes per scan); log body is unified udiff; `attributes.emission` preserves verbatim model emission; `attributes.patch` retired. |
| D2 | `src/plugins/budget/README.md:36` | `ANCHOR_ORDER` doc still lists `repo` — leave as-is (the manifest's catalog tile placement is unchanged). |
| D3 | `feedback_extension_surfaces.md` (memory) | Add example: `repo` scheme stays even though one path lives there. Don't conflate "few callers" with "remove." |

**Order:** T1 → E1 → T2 → E2 → T3 → E3 → T4 → E4 → T5 → E5 → D1 → D2 → D3.
Standard red-green for each pair.

### Manifest paradigm + loopId migration finish

Surfaced 2026-05-12 by gemma demo + gemma e2e + grok re-run. Three
intertwined defects, one root paradigmatic shift:

1. **Manifest dominated `<index>`.** E3's per-scan refresh + files-
   default-`archived` made `repo://manifest` the ONLY visible
   file-listing surface, rendering its full body. The packet taught
   the model that `repo://` is the file scheme — grok rationally
   wrote `<set path="repo://compile.sh">`. The manifest's role is the
   compaction lifeline, not the primary inventory.
2. **loopId migration incomplete.** Yesterday's path-shape migration
   to `log://<L>/<T>/<S>/<action>` keyed `turns` on `(run_id,
   loop_id, sequence)` with `loop_id NOT NULL`. But `run_views.
   loop_id` and `turn_context.loop_id` were left nullable, and
   multiple write callers (`AgentLoop.resolve`, `rpc.js#update`,
   `rpc.js#dispatchSet`) didn't thread `loopId`. Symptom: `[RUMMY]
   RPC Error: NOT NULL constraint failed: turns.loop_id` whenever a
   `state="failed"` write fires `#fireFailed → error.log.emit →
   logPath → next_turn_seq` with `loop_id = undefined`.
3. **No turn-0 budget plan.** With files about to default `indexed`
   (rich orientation), real-world projects may overshoot the
   ceiling on turn 1. Today's grinder reclaims fat replays — but
   turn 1 has none. Without a plan, oversized projects hard-413
   before their first dispatch.

**Paradigmatic shift:** files become the primary inventory; the
manifest becomes the compaction lifeline.

- File default visibility: `archived` → `indexed`. Each file is a
  symbol-bearing tile in `<index>` at run init.
- `repo://manifest` tile in `<index>`: empty body. Inventory of
  record retrievable via `<get repo://manifest>`.
- Manifest stays per-scan refreshed (model must trust it's current).
- Turn-0 budget gate: if assembly overshoots at run init, archive
  all `<index>` tiles except `repo://manifest`. Single invariant,
  no priority heuristics.
- Run-level state (run status / lifecycle) lifts off `run_views` to
  a column on `runs`; `run_views` becomes strictly per-loop.

**Schema refactor (Option 2b — strict):**
- `run_views.loop_id INTEGER NOT NULL REFERENCES loops(id)`
- `turn_context.loop_id INTEGER NOT NULL REFERENCES loops(id)`
- Add `runs.outcome TEXT` (nullable, populated on terminal failure).
- Add `runs.prompt TEXT NOT NULL DEFAULT ''` (initial run prompt
  moves off the dropped `run://<alias>` entries.body).
- `run://<alias>` is DROPPED from `entries` / `run_views` entirely.
  The RPC lifecycle interface (`set run://...`) stays for clients,
  but server-side dispatch mutates `runs` directly.
- `Entries.set` rejects `run://*` paths — the scheme is no longer a
  valid entries path.

**Tests-first**

| # | File | Test name | What it pins | Expected failure today |
|---|---|---|---|---|
| T1 | new `test/integration/run_views_loop_id_not_null.test.js` | "run_views insert without loop_id raises constraint error" | Direct `upsert_run_view.run({...loop_id: null})` rejects; existing nullable column accepts. | Schema allows NULL. |
| T2 | new `test/integration/run_level_state_on_runs.test.js` | "run lifecycle state lives on runs.status, not run_views" | After `AgentLoop.start(...)`, query `runs.status`; assert run-level state column populated; assert no `run_views` row for `run://<alias>`. | Today `run://<alias>` has a run_views row. |
| T3 | new `test/integration/agent_loop_resolve_threads_loopid.test.js` | "AgentLoop.resolve(reject) writes succeed with loopId derived from path" | Seed a proposed entry at `log://1/12/2/set`, call `resolve(reject)`, assert state=failed write succeeds and error.log entry lands at `log://1/12/<S>/error`. | Today crashes at `next_turn_seq` NOT NULL. |
| T4 | new `test/integration/rpc_update_threads_loopid.test.js` | "RPC update looks up current loop and threads loopId+turn" | Seed an active loop, call update RPC; assert `log://<L>/<T>/<S>/update` path lands correctly. | Today crashes at `next_turn_seq` NOT NULL. |
| T5 | `rummy.repo/main/src/FileScanner.test.js` (existing) | "scanned files default to indexed visibility" | After scan, every bare-path entry has `visibility = "indexed"`. | Today default is `archived`. |
| T6 | new `test/integration/manifest_tile_empty_body.test.js` | "repo://manifest tile renders empty body in <index>" | Assemble context; assert `<index>` contains `repo://manifest` envelope but no body bytes. | Today body renders verbatim. |
| T7 | same file | "<get repo://manifest> returns the full inventory body" | Model `<get>`s the manifest path; assert the retrieved body matches the canonical JSON-per-row list. | Today same (no change needed; pin behavior). |
| T8 | new `test/integration/turn_zero_budget_gate.test.js` | "turn-0 oversize → archive all indexed tiles except repo://manifest" | Seed project where indexed-tile total > ceiling; assemble; assert only `repo://manifest` remains indexed in the final assembly. | Today: no gate; budget grinder hard-413s on turn 1. |

**Engine fixes**

| # | File | Change | Makes which test pass |
|---|---|---|---|
| E1 | `migrations/001_initial_schema.sql` | `run_views.loop_id` and `turn_context.loop_id` → NOT NULL. Add `runs.outcome TEXT` and `runs.prompt TEXT NOT NULL DEFAULT ''`. | T1, T2 |
| E2 | `src/agent/runs.sql` + new prep | New `set_run_state(run_id, status, outcome)` query. `create_run` accepts `prompt`. | T2 |
| E3 | `src/agent/AgentLoop.js:94, 115, 656` + `src/plugins/rpc/rpc.js:#dispatchRunSet` | Drop `entries.set` for `run://*`. Run lifecycle writes target `runs` directly via `set_run_state`. `Entries.set` rejects `run://*` paths with a hard error. | T2 |
| E4 | `src/agent/AgentLoop.js:185, 596, 635` | Parse `log://<L>/<T>/<S>/<action>` path; look up `loop_id` via `get_loop_by_sequence`; thread `loopId` + `turn` to `entries.set`. Hard-fail if loop not found (no fallback). | T3 |
| E5 | `src/plugins/rpc/rpc.js:129` | `entries.update` from RPC looks up current loop via `get_current_loop` (existing prep); thread `loopId` + current `turn` from loop's `next_turn - 1`. Hard-fail if no active loop. | T4 |
| E6 | `src/plugins/rpc/rpc.js:516` | `dispatchSet` parses log-scheme paths; threads loopId. Non-log paths: look up current loop. Hard-fail if missing. | T3 / T4 |
| E7 | `rummy.repo/main/src/FileScanner.js` | Default file visibility in constraint mapping: `archived` → `indexed`. Pass `loopId` on manifest write (FileScanner already has it from `get_current_loop`). | T5 |
| E8 | `rummy.repo/main/src/rummy.repo.js:24` | `onView("repo", ...)` returns empty body. Bypassed when retrieved via `<get>` (which reads `entry.body` directly). | T6, T7 |
| E9 | `src/agent/ContextAssembler.js` (or wherever `<index>` materializes) | After computing total assembled tokens at turn-0, if over ceiling: archive every `<index>` tile except `repo://manifest`; re-assemble. | T8 |

**Doc + spec alignment**

| # | File | Change |
|---|---|---|
| D1 | `SPEC.md` Project Manifest section | Reframe: manifest is the **compaction lifeline**, not primary inventory. Tile body empty in `<index>`. Files default `indexed`. Turn-0 budget gate behavior. |
| D2 | `SPEC.md` Schemes table | Update `repo://` row: view renders empty body; full retrievable via `<get>`. Update bare-path row: default `indexed`. |
| D3 | `SPEC.md` (new section) | Run-state separation: `runs.state` holds run-level lifecycle; `run_views.loop_id` NOT NULL. |
| D4 | `SPEC.md` Budget section | Document turn-0 gate: oversize → archive all `<index>` except `repo://manifest`. |

**Order:** Schema (E1, E2) → run state separation (E3, T2) → loopId threading (E4, E5, E6, T3, T4) → file visibility (E7, T5) → manifest tile body (E8, T6, T7) → turn-0 gate (E9, T8) → docs (D1-D4).

Each pair red-green. Land as one cohesive change set per user direction.

## Scope Discipline

- No legacy protocol accommodation. 2.0 is 2.0.
- External plugins are rewritten or cut. No side-maintenance tracks.
- Everything the contract names has a concrete realization in code.
  Everything the contract doesn't name, isn't there.

## Lessons (keep these pinned; don't let future sessions forget)

- **`log://` body is immutable to the model.** A model that learned
  the archive pattern from instructions-user.md
  (`<set path="X" archive/>`) will sometimes adapt it with a body
  line — destroying historical search results / sh output / etc. The `<set>` handler now rejects `<set path="log://..."` with
  non-empty body as `method_not_allowed` (terse 405 in the entry's
  outcome), surfacing a one-line nudge that points at the body-less
  shape. Visibility/metadata-only writes still flow through normally.
  Reasoning: log entries are time-indexed records of what happened —
  the model can re-rank them but not rewrite history. This is the
  one place where the engine polices the model's grammar; it earns
  its keep because the alternative is silent destruction of the
  reasoning trace.
- **System-prompt growth eats budget. Calibrate test ceilings when
  you grow it.** When instructions-system.md or `[%TOOLDOCS%]`
  expansion grows, every test that pins `contextLimit` near the
  rendered system size starts overflowing on turn 1 before the model
  has done any work. The `tight-context` story regressed exactly this
  way — system://1 hit ~3851 tok, leaving <1600 tok for everything
  else against a 5400 ceiling. Fix is to bump the test's
  `contextLimit` minimally (just over the natural turn-3 packet
  growth ~6065 tok → contextLimit 7000 → ceiling 6300). Bigger fix is
  "teach more with less" — but that's a separate pass.

- **The contract is lean.** The engine enforces three things via
  the strike system: budget overflow, repetition (cycle detection),
  and per-turn `<update>` inclusion. Plus the ask-mode shield (run
  permissions, separate from workflow). Everything else is the
  model's responsibility, taught via `instructions-system.md`,
  `instructions-user.md`, and tooldocs. Don't add engine-side
  enforcement to police model workflow — it gets re-imagined as
  fixed-shape choreography that the model misreads as exclusive
  permissions, and weak models bounce off it instead of doing work.
- **`source .xai.key` before any xAI-touching launch.** Claude's
  Bash subshells inherit a stale `XAI_API_KEY` from a pre-fix shell
  session; `.bashrc` fix doesn't propagate to existing subshells.
  Symptom: every turn dies at 500 with `400 Incorrect API key`.
  `.xai.key` is a one-line `export XAI_API_KEY="..."` the user
  maintains for this. Don't parse `.env` manually — quoted values
  get mangled.
- **Plugin extensibility is a promise.** Don't delete "unused"
  events from `Hooks.js` — they're the extension surface.
- **Instruction prose is a four-register grammar. Respect it.**
  Every line is paid every turn — treat as load-bearing.
  - **`YOU MUST` / `YOU MUST NOT`** — contract floor. Reserve for
    actual contracts; overuse devalues. Pair with `Example:`.
  - **`*` bullets** — affordances ("you can"). Insufficient for
    contracts.
  - **`Example: <tag/>`** — highest signal density. Models
    pattern-match examples over prose; if they conflict, the
    example wins. Bad examples poison.
  - **`{ ... }`** — placeholder semantics inside Example:.
    Description inside the braces does the work.

  Failure-mode signals: `YOU MUST` everywhere → ignored. Examples
  contradicting prose → example wins. Lazy taxonomies in examples
  (`known://temp_*`, `known://hydrology/*`) → model imitates
  literally; use hierarchical paths
  (`known://geography/indiana/orange_county/*`). Cross-doc
  repetition of the same rule is reinforcement; same rule restated
  in different words within one doc is dilution.

- **Configuration is the cascade.** `.env.example` declares every
  var with a sane default; `.env` and profile overlays
  (`.env.tbench.<profile>`) override; shell wins. npm scripts load
  via `--env-file-if-exists`. **Forbidden:** boot-time validators,
  per-module guards (`if (!process.env.X) throw`), fallback
  constants (`Number(X) || 4`, `?? "default"`). When a read
  produces undefined/NaN, the fix is `.env.example`, not the read
  site. **Exceptions:** provider API keys (`XAI_API_KEY`,
  `OPENAI_API_KEY`) and optional backend selectors stay as direct
  reads, throw at first use. Feature-flag bools use
  `process.env.X === "1"` exactly — never `=== "true"`.

- **Decide, don't dawdle.** When naming or scope questions arise,
  resolve them in-session or ask the user — don't defer to a
  "follow-up pass" that never happens.
- **OpenRouter cache state is unreliable.** Routing flips mid-
  session (`is_byok: false → true`); cache hit can drop 99→2%
  across the flip on bit-identical prefix. For latency/caching
  analysis route direct (`xai/grok-4-1-fast-reasoning`); reserve
  OpenRouter for leaderboard-comparison runs where matching the
  leaderboard's upstream matters.
- **Cost under BYOK.** OpenRouter `usage.cost` reads 0 when BYOK
  — real spend is in `usage.cost_details.upstream_inference_cost`.
  Telemetry uses that as fallback.
- **Model-facing messages state desired behavior, not enforcement
  mechanics.** Strike system / cycle detection / MAX_STRIKES are
  internal — the model figures out pressure from accumulating
  entries, not from narration. Reminders read as directives, not
  rulebooks. When the user dictates wording, transcribe verbatim.
- **Attribute semantics must not split on context.** An attribute
  on a state tag must mean the same thing as on an action tag in
  the log — otherwise the model re-emits actions to "fix" phantom
  state. Two-state visibility lives on `<set archive/>` /
  `<set index/>` precisely because a single grammar across read
  and write avoids the split.
- **Time-indexed vs topic-indexed paths.** Log entries are time-
  indexed (path encodes turn). State entries (knowns, files,
  unknowns) are topic-indexed (path encodes identity, turn is
  metadata). If identity is WHEN, turn goes in the path; if WHAT,
  turn is an attribute.
- **Malformed XML from the model = audit our examples first.**
  Models reproduce what they see. "Unclosed `<set>`" / "wrong
  attribute name" has often been a typo or unbalanced tag in our
  own instruction examples.
- **Unknown spamming is real.** Weak models emit 90+ visible
  unknowns up front on fact-heavy ingest, then grind. Front-loaded
  over-decomposition is a failure mode, not a baseline.
- **Prompt smell trumps "flaky model."** When a small model
  misbehaves, verify the prompt isn't asking it to violate a
  documented rule (e.g., "run `ls` via `<sh>`" against shDoc's
  "use `<env>` for read-only"). The "model is flaky" framing is
  usually a prompt audit failure.
- **Reasoning-runaway is a model pathology.** Small models spiral
  inside `reasoning_content` — same action planned forever, no
  emission. No instruction edit reaches the stuck state; the
  strike-streak watchdog handles it. Don't coach for the runaway
  state — analyze the turn *before* the spiral.
- **Stochastic agentic tests should accept the engine's terminal
  set, not just success.** Identical prompts on identical models
  can land 200 or 499 depending on the decision tree the model
  walks. A test asserting strict 200 on an agentic run is flaky by
  construction. Either widen the assertion to `[200, 499]` (or
  whichever set is legitimate for the test's intent) or move the
  test to `test/live/` where stricter outcome verification is the
  whole point. The engine guarantees terminal reachability, not
  deterministic success.
- **Output inside an input-shaped tag gets reproduced as input.**
  When a log entry's wrapper matches the model's tool-call tag
  (`<search>` etc.), the body must lead with a marker the model
  won't emit as a tool — markdown bullets work. Don't render
  search results as `URL — title` lines under `<search>`; render
  as `* URL — title`.
- **State transitions don't mint new entry ids.** `since:
  lastSeen` filters miss state changes (resolved → proposed
  rewrites the row in place). Any client tracking state via
  `since: id` needs full-scan + dedupe via resolved-set, not
  optimization-by-id-watermark.
- **Multi-stage view carve-outs must mirror at every stage.** A
  carve-out at the visibility CTE without one at the
  body-projection CTE preserves the row but zeros the body
  silently — strictly worse than no carve-out. Pin with
  integration tests at every layer.
- **Block ordering is a cache-vs-recency trade.** User message
  current order (sandwich): `<persona>` (10) → `<log>` (50) →
  `<turn>` (90) → `<instructions>` (165, late so rules sit at the
  action site). Front-loaded ordering (instructions at front)
  cached more (~61% vs ~15%) but lost discipline tests in e2e —
  the model forgot to emit terminal `<update>` when the rule was
  3K tokens upstream of the action. Don't reorder priorities
  without considering both effects.
- **Read the wire body, not the config.** Provider plugins once
  hardcoded `think: true` / `include_reasoning: true` while a
  config knob suggested otherwise. Symptom: "gemma
  reasoning-runaway." The harness bug hid behind a model-pathology
  story for weeks. When a model exhibits a documented pathology,
  read the actual outgoing request body before classifying.
- **Gemma emits `<think>` we never advertised.** Deep CoT
  training prior; emits `<think>...</think>` regardless of whether
  the harness advertises it. The think plugin absorbs it
  gracefully (scheme always registered, handler conditional on
  `RUMMY_THINK`, reasoning-merge filter folds bodies into
  reasoning_content). Mitigations are model-side
  (chat-template / sampler / stop-token / variant swap) — not
  harness-side.
- **`turns.reasoning_tokens=0` is not "no reasoning."** Llama-server
  bundles reasoning into `completion_tokens` rather than splitting.
  Verify reasoning capture via `reasoning://N` entry sizes, not
  the per-turn counter.
- **Parser warnings are soft, not strikes.** Recoverable XML
  pathology that the parser handled doesn't penalize. `error.log`
  takes a `soft` flag; soft entries land `resolved` and skip
  `turnErrors++`. Missing-update / no-actionable-tags / dispatch
  crashes / context-exceeded stay strike-eligible.
- **Verifier-mutation impulse is a real benchmark-integrity
  threat.** Models can emit `<set>` against test files documenting
  how to patch the verifier. Tbench harbor adapter excludes
  `test_*.py` / `*_test.py` / `tests/*` from project-files ingest;
  the verifier is run via `<sh>` but its source isn't an entry the
  model engages with. Mirror this carve-out for any benchmark
  where the agent has filesystem write access to test code.
- **Detached spawn + process-group signaling for runner-side child
  management.** Spawn without `detached: true` plus a parent kill
  leaves the child reparented to init, where it continues making
  LLM calls invisibly. Cost the user $24.70 on opus (60 expected
  turns + 59 phantom turns post-kill). Fix: spawn with
  `detached: true`, install SIGTERM/SIGINT propagators on the
  runner that signal `-child.pid` (process group), with 5s SIGKILL
  escalation. Apply this pattern anywhere a node script spawns
  long-running children that the user might Ctrl-C. The earlier
  watchdog only handled container-disappears; orphaned-child was
  the missing half. (`test/programbench/runner.js`, 2026-05-07.)

- **Frontier models including opus default to one-shot synthesis
  even with explicit `YOU MUST` instructions.** Capability does
  not equal result. The protocol's job is to prevent any model
  from outrunning its own working memory; frontier models think
  they don't need it; the data says they do. A 4B-active model
  obeying the rails out-executes opus on the same task at 1/240th
  the cost. This is why engine-side rails matter more than prompt
  strengthening — surface persona ("you are the rule-follower
  mayor of FollowsRulesville") doesn't override the synthesize-
  and-ship RLHF prior. Build forcing functions, don't write
  stronger prose.

- **Benchmark task containers are heterogeneous.** Tbench: tasks
  span Ubuntu Jammy (22.04) and Noble (24.04, t64-renamed libs).
  Apt package names diverge across the t64 transition. Use stable
  names + `pkg-t64 || pkg` fallback chains. Don't assume
  homogeneous base images across a benchmark dataset.

## Ongoing Development Conversation (ALERT: LLM APPEND CONVERSATIONAL FEEDBACK HERE)

*Append entries here only when there's an actually-ongoing
conversation worth tracking across sessions (an in-flight refactor
mid-stream, a deferred decision with a real follow-up, a debugging
thread that hasn't resolved). Landed work belongs in git history;
durable rules belong in the standing rules block above; durable
observations belong in the Lessons section. Don't chronicle what
the diff already records.*

### Instruction-side findings (gathering for a focused session)

Sacred prompts (`instructions-system.md`, `instructions-user.md`,
`*Doc.md`) get edited together in a single deliberate pass, never
piecemeal. Append issues here; when saturated, request explicit
go for a focused instruction-edit session.

- **CC-8a — Reasoning-vs-emission gap.** Model plans actions in
  `reasoning_content`, doesn't emit them. Cross-test pattern.
- **CC-12a — `sh`/`env` MUST-clause repetition.** 6 negatives for
  2 binary distinctions; tooldoc cleanup.
- **PF-2 — Persona_fork run start** doesn't recognize
  fork-inherited knowns; weak models confabulate new unknowns.


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

**Test taxonomy** (`test/TESTMAP.md`):
- `src/**/*.test.js` — unit, fast, mocked.
- `test/integration/` — cross-component, in-process, mock LLM. Uses
  `TestDb.seedRun()` scoped store so tests don't repeat the
  `(runId, loopId)` contract dimensions on every call.
- `test/live/` — technical-contract tests against real LLM
  (streaming RPCs, terminal-state notifications, yolo
  auto-resolution, fork preservation, etc.).
- `test/e2e/stories/` — one user behavior per file. Heading
  describes what the user does, body asserts the outcome.
  `StoryHarness` owns shared setup so each story stays small.

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

### Spirit clause

Reduce complexity by manifesting ideals already described, not by
extending the architecture with new features. Each move should
make the codebase smaller and the contract crisper. If a proposed
extraction adds a hop without separating concerns, it's ceremony
— drop it.

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

- **Contract dimensions belong in helpers, not test bodies.** When
  a write-time invariant has multiple required args together (here:
  `loopId` joining `runId` on every per-loop write), the test
  harness captures those dimensions in a scoped helper.
  `TestDb.seedRun()` returns `{store, runId, loopId}` where `store`
  binds the contract dimensions; tests call `store.set({...})`
  without repeating them. If a refactor has you adding the same
  arg across N test files, the helper is wrong, not the tests.

- **Migration completeness is a schema check, not a code review.**
  The path-shape migration to `log://<L>/<T>/<S>/<action>` made
  `turns.loop_id NOT NULL` but left `run_views.loop_id` and
  `turn_context.loop_id` nullable. The asymmetry let code drift
  silently — most paths threaded the new dimension, a few didn't,
  and the test suite didn't catch the gap because tests passed
  null. The fix was to make the schema enforce uniformly: tighten
  every joined/sibling table when introducing a new required
  dimension. Hard crashes at the SQL layer surfaced every code
  path that drifted in one shot.

- **Catalog tiles render envelopes, not bodies.** Anything that's
  a catalog (`<index>` files, `repo://manifest`) shows an envelope
  (path + token cost) in tile rendering; the body is the lifeline
  retrievable via `<get>`. Falling through to raw body in a view
  hook is what bloated the floor and trained the model that
  `repo://` was the file scheme. View hook for a category=data
  scheme should return symbols (when present) or empty —
  never the full body. Bodies live in `<log>` after a deliberate
  `<get>`, never in catalogs.

- **`<cp>` and `<mv>` to bare paths decompose into set proposals.**
  Wire surface clients render is uniform: every file-creation
  proposal lands at `log://<L>/<T>/<S>/set` with `attrs.path`,
  `attrs.patched`, `attrs.patch` (udiff), `attrs.op`. The model's
  emission verb (`<cp>`, `<mv>`, `<set>`) is preserved in the log
  recap path for audit but invisible to clients. mv's source
  removal is atomic on set accept — no second prompt. Mixing
  cp/mv-specific attrs into the proposal surface (`attrs.from`,
  `attrs.isMove`) makes clients render "copy" prompts that
  diverge from the file-creation UI; don't do that.

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


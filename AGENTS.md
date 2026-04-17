# AGENTS: Planning & Progress

> "Is there a rummy way to do this?" Every `<tag>` the model sees is a
> plugin. Every scheme is registered by its owner. Every piece of data
> exists as an entry or a column. No exceptions without documentation.

> **Everything is an entry.** Unix's "everything is a file" principle
> applied to agent systems. Files, tool calls, streaming output, plans,
> unknowns, sub-agents — all entries. Read/write (`<get>`/`<set>`) is the
> universal grammar. New capabilities compose by producing entries in
> the shared substrate. See SPEC §0.1.

> **"Model behavior" is never an acceptable explanation for a test failure.**
> When a model misbehaves, the system failed — suboptimal context, poorly
> designed test conditions, insufficient reinforcement of correct behavior.
> Every failure is a system bug until proven otherwise.

## Current State

Plugin-driven architecture. Instantiated classes, constructor receives
`core` (PluginContext). Registration via `core.on()` / `core.filter()`.
Assembly via `assembly.system` / `assembly.user` filter chains.
Loops table (projects > runs > loops > turns).
HTTP status codes throughout (entries, runs, loops, client RPC).

11 model tools: think, get, set, env, sh, rm, cp, mv, ask_user, update,
search. Tool priority ordering (think first, search last). Unified tool
exclusion via `resolveForLoop(mode, flags)`. `known` and `unknown` retired
as emission tags (model uses `<set path="known://...">` and
`<set path="unknown://...">`); plugins remain for rendering and filters.

Three fidelity levels: full, summary, archive.

Token math: `ceil(text.length / RUMMY_TOKEN_DIVISOR)`. No tiktoken.
`known_entries.tokens` always stores full body cost. `turn_context.tokens`
stores actual context cost at current fidelity. Budget enforcement
measures assembled messages, never stored token sums.

### Dispatch

Tools dispatch as a sequential queue in the order the model emitted
them. No lifecycle/action split. No reordering.

- Each tool succeeds (200), fails (400+), or proposes (202)
- On failure: abort remaining tools
- On proposal: push `run/proposal` notification to client, await
  resolution inline, continue dispatch
- `ask`/`act` RPC response sent only when all tools complete
- Post-dispatch: budget check (independent of tool outcomes)
- Lifecycle: `<update status="200">` terminates, `<update status="102">` continues

### Budget

Ceiling = `floor(contextSize × RUMMY_BUDGET_CEILING)`. 10% headroom.

- **Turn Demotion** (post-dispatch): context exceeds ceiling → budget
  plugin demotes all entries from this turn, writes `budget://` entry
  with per-entry token costs and overflow amount
- **Prompt Demotion** (pre-LLM): new prompt doesn't fit → summarize
  prompt, model runs in headroom
- **LLM rejection**: turn-1 estimate drift → `isContextExceeded` catch
- Previous-loop entries: model-managed via preamble instruction

### Preamble Structure
```
Preamble (identity)
# Tool Commands (tool list)
# Tool Rules
  ## Response Rules
  ## Folksonomic Memory Management
  ## Fidelity Management
  ## Token Budget Management
  ## Response Termination
# Tool Usage (tooldocs)
```

### Plugin Ownership

Each tool plugin owns its own recording, dispatch, and view logic.
TurnExecutor orchestrates the pipeline; plugins handle specifics:

- `known` — size gate, slug path, dedup, scheme prefix
- `unknown` — dedup, slug path
- `update` — slug path recording, status attribute for lifecycle
- `budget` — enforce, postDispatch (Turn Demotion)
- `policy` — ask-mode restrictions via entry.recording filter
- `think` — gated by RUMMY_THINK, tooldoc registration

## Paradigmatic Refactor: Status vs Lifecycle (Precedes Streaming)

**The confusion:** `known_entries.status` is currently used for two
distinct concerns — the HTTP outcome of the last body operation AND the
entry's lifecycle phase. Turn Demotion flips status to 413 on demoted
entries, overwriting their real outcome with a lifecycle event. We've
been papering this over with scheme-specific preservation exceptions
(set/rm/mv/cp keep 200 through budget panic). Adding 102 streaming
entries would require yet another exception. The exception list is a
symptom, not a pattern.

**The fix:** `status` reflects body operation outcome only. Lifecycle
events (budget demotion, archive, supersede) change `fidelity` but
never `status`. The model reads status for truth about the operation
and fidelity for visibility — two orthogonal signals, legible separately.

**Scope (minimum viable):**

- `demote_turn_entries` SQL: only changes `fidelity` and `updated_at`.
  Drop the scheme-specific status-preservation CASE — it becomes the
  default for everything.
- `budget/budget.js` post-dispatch: drop the get-result body rewrite
  that forces status=413. The get-result entry's original outcome
  (status=200, body "X promoted (N tokens)") stays truthful; fidelity
  demoted signals it's no longer in context. The budget:// entry is
  the canonical panic record.
- Tests: `test/integration/budget_demotion.test.js` — update assertions
  to expect preserved status (200 stays 200 after demotion).
- Diff estimate: ~25 lines source + ~15 lines test. Clear cuts, no new
  columns, no migration.

**What we lose:** the "which entries were demoted by this turn's panic?"
question becomes "which entries have fidelity=demoted AND were written
on turn N?" instead of "which entries have status=413 AND turn=N." The
budget:// entry already records the event authoritatively; per-entry
status=413 was redundant signal.

**What we gain:** streaming entries at status=102 pass through budget
demotion without needing a special case. Future lifecycle events (sub-
agent spawn, file watch start, whatever) don't accrete new status-
preservation exceptions. The data model matches reality: operation
outcome and lifecycle phase are different facts.

This refactor lands first, then streaming builds on the cleaner base.

## Streaming Shell / Env (Design Sketch — v1)

Shell and env commands vary in duration by orders of magnitude (0.5s for
`git log` to 4 hours for benchmarks). The current synchronous-block model
freezes the client and the run for the command's entire duration. For
real daily-driver use, this is disqualifying. Applying Unix's
"everything is a file" principle: shell output is first-class data in
the folksonomy. Every command produces entries that live, grow, and
terminate. Short commands appear complete by next turn; long commands
stay at status 102 across many turns. The agent's interface is identical.

**Entry shape: log + data split, numeric channels**

Each command produces a **log entry** (event record) plus **data
entries** (output streams, one per channel):

```
sh://turn_N/{slug}     category=logging  status=200
                       body: "ran 'command', exit=0 (2.3s). Output: sh://turn_N/{slug}_1 (12kb), sh://turn_N/{slug}_2 (empty)"
                       attrs: { command, duration, exit_code }
                       (renders in <performed>)

sh://turn_N/{slug}_1   category=data     status=102→200/500
                       body: stdout stream
                       summary="{command}"  fidelity=demoted
                       (renders in <knowns>)

sh://turn_N/{slug}_2   category=data     status=102→200/500
                       body: stderr stream (empty if none)
                       summary="{command}"  fidelity=demoted
                       (renders in <knowns>)
```

**Channel numbering follows Unix file descriptor convention.**
Channel 1 is stdout, channel 2 is stderr; stdin (0) doesn't apply to
output entries. Producers that aren't process-shaped still map their
streams onto the same numeric space: `_1` for primary output, `_2`
for errors/anomalies, `_3`+ for additional streams. Mapping to FD
numbering gives shell users an immediately familiar convention and
generalizes cleanly for future producers.

**Rationale for the split:**

- The **log entry** answers "what actions happened on turn N?" — read
  by the model scanning history. Renders in `<performed>`. Small, cheap.
- The **data entries** answer "what did those actions produce?" — read
  only when the model cares about details. Render in `<knowns>`.
  Demoted by default, promoted selectively via `<get>`.

The log entry's body links to the data entries by path (e.g.
`"exit=0. Output: sh://.../_1 (12kb)"`), so discoverability is
preserved without a separate relation mechanism.

**Status lifecycle:**

- Log entry: created at status=200 when the user accepts the proposal
  (the action "happened"). Body updates on completion to include the
  exit code and durations.
- Data entries (_1, _2, ...): created at status=102 when the user
  accepts the proposal. Transition to 200 (exit_code=0) or 500
  (non-zero) on completion. 102 is HTTP "Processing" — existing
  paradigm fits.
- Proposal entry itself (the original `sh://turn_N/{slug}` at 202)
  transitions to 200 on accept → becomes the log entry.

**Protocol:**

- Generic stream RPC: `stream { run, path, channel, chunk }` — channel
  is a numeric id. Server appends chunk to `{path}_{channel}` via the
  new `append_entry_body` SQL prep. Any plugin producing a streaming
  entry uses this RPC.
- Completion RPC: `stream/completed { run, path, exit_code? }` — sets
  terminal status on all `{path}_{N}` entries (200 on exit_code=0, 500
  otherwise). Updates the log entry body with final stats. Producers
  whose completion isn't process-shaped (search, fetch) can omit
  exit_code and default to 200.

**Plugin ownership:**

- A dedicated `stream` plugin owns the generic `stream` and
  `stream/completed` RPC handlers. Writes to the shared substrate via
  `appendBody` and status transitions.
- `sh` and `env` plugins just create the proposal entry on dispatch
  and declare scheme ownership. The transition from 202 proposal to
  102 streaming happens in `AgentLoop.resolve()` (sh/env branch) or
  via a hook subscription from the stream plugin. They are consumers
  of the streaming substrate, not implementers.

**sh and env are one behavior under two schemes.** Policy differs (env
is safe/read-only; sh has side effects — different ask-mode
restrictions). The streaming mechanism is identical. Client can
distinguish in UI; the server treats them identically for streaming.

**Other decisions:**

- Concurrency: no wake-on-completion. Turns remain human-triggered.
  A command completing mid-idle queues the completion; next user
  prompt assembles context including the now-complete entry.
- Abort/cancel: two directions, symmetric outcome (both → 499).
  `stream/aborted` = client-initiated (client kills, then reports).
  `stream/cancel` = server-initiated (server transitions immediately,
  pushes `stream/cancelled` notification to connected clients).
  Also handles stale 102 cleanup when the originating client is gone.
- Connection fragility: no assumption of stable client connection.
  Chunks arrive when they arrive; if completion never signals (client
  died), entries sit at 102 forever — which is truthful. Any client
  can call `stream/cancel` to mark stale entries terminal.
- Backpressure: none in v1. SQLite handles writes. Model uses
  line/limit on `<get>` to tail without full promote.

**Out of scope (explicitly):**

- Client-side cancellation UX (keybinds, confirmation, etc. — client concern)
- Sub-agents, forks, swarms
- LLM-as-tool streaming reasoning
- File watches / observer tools
- Multi-agent collaboration protocols (future: emerges naturally from
  multiple agents sharing `data` category entries with separate
  `logging` — no special protocol needed)

**What the agent sees:**

```
Turn 1: <sh>npm run test:mab</sh>
  → proposal (202), user accepts, command starts

Turn 2 (command still running):
  <performed> shows:
    <sh path="sh://turn_1/npm_test_mab" turn="1" status="200" tokens="22">
    ran 'npm run test:mab' (in progress). Output: sh://turn_1/npm_test_mab_1, sh://turn_1/npm_test_mab_2
    </sh>
  <knowns> shows:
    <sh path="sh://turn_1/npm_test_mab_1" turn="1" status="102"
        summary="npm run test:mab" fidelity="demoted" tokens="847"/>

  Model reads: "still running, 847 tokens of output so far."
  Model can: <get path="sh://turn_1/npm_test_mab_1" line="800" limit="50"/>
  to tail recent output without promoting.

  Or continue unrelated work — agent isn't blocked.

Turn 7 (command completed):
  <performed>:
    <sh path="sh://turn_1/npm_test_mab" turn="1" status="200" tokens="58">
    ran 'npm run test:mab', exit=0 (4:23). Output: sh://turn_1/npm_test_mab_1 (12kb), sh://turn_1/npm_test_mab_2 (empty)
    </sh>
  <knowns>:
    <sh path="sh://turn_1/npm_test_mab_1" turn="1" status="200"
        summary="npm run test:mab" fidelity="demoted" tokens="12443"/>

  Model sees terminal state. Promotes data entry if interested.
```

**Generalization — streaming entries as a rummy idiom:**

Once the stream plugin exists, other tools that produce data over time
adopt the pattern: search results streaming in, web fetch of large
pages, log tails, file watches. Each creates a log entry plus N data
entries (numbered channels), appends via `stream` RPC, transitions to
200 on completion. The grammar stays uniform. The agent's mental
model stays simple: entries are data; some grow, some don't; status
tells you which; numbered channels tell you severity rank.

The core bet, extending "everything is an entry": **time becomes a
property of data, not a property of calling conventions.** Currently
most agent systems model "this is fast" vs "this is slow" implicitly
via sync/async API boundaries. Rummy makes duration a property: status
102 means "still producing," status 200/500 means "done." The
distinction is semantic data the model reads, not an API boundary the
system enforces. Parallel execution, cancellation, timeout — all
uniform operations on entries rather than per-tool machinery.

## Completed This Session (2026-04-15 — 2026-04-17)

### Streaming v1
- [x] `stream/aborted` — client-initiated cancellation (→ 499)
- [x] `stream/cancel` — server-initiated cancellation + notification
- [x] Stale 102 cleanup via `stream/cancel`

### Client contract unification
- [x] Unified history shape: `{ tool, path, status, body, turn, attributes }`
- [x] Incremental `run/state` after every tool dispatch
- [x] History includes prompt, unknown, and logging entries
- [x] `get_history` retired — one query, one view, one contract

### Parser hardening
- [x] Retired `<known>`/`<unknown>` emission tags from tooldocs
- [x] `#correctMismatchedCloses` preprocess in XmlParser
- [x] `#neutralizeCodeSpans` — backtick-quoted tool tags ignored
- [x] Removed `known` and `unknown` from ALL_TOOLS

### `<summarize>` → `<update status="200">`
- [x] Update tool carries status attribute for lifecycle
- [x] Summarize plugin deleted, scheme retired
- [x] All SQL queries, tests, benchmark runners updated
- [x] ResponseHealer returns warning strings, no console.warn

### Error plugin
- [x] `error` scheme: `category: "logging", model_visible: 1`
- [x] Error plugin: `hooks.error.log.emit()` → entry creation
- [x] XmlParser warnings, missing status, healer, dispatch crashes,
  cycle detection, stall detection — all emit error hook
- [x] ResponseHealer: zero console calls, all feedback via entries

### Set handler unification
- [x] Uniform result shape for file writes and scheme writes
- [x] `attrs.file` → `attrs.path` everywhere
- [x] Direct scheme writes produce SEARCH/REPLACE diffs
- [x] New file proposals auto-activate via file constraint

### rummy.web
- [x] `http`/`https` scheme registration (content was invisible)
- [x] Search prefetch with real token counts
- [x] Persistent browser context with 15-min idle timeout
- [x] 5-second prefetch timeout, failed pages suppressed
- [x] Get handler: prefetched URLs promote without refetch

### Bug fixes
- [x] Policy-rejected entries no longer dispatched (SQLite crash)
- [x] Empty SEARCH block = full replacement, not prepend
- [x] Sed replacement unescapes regex metacharacters (`\[x\]` → `[x]`)
- [x] Resolve handler applies patches to new files (null body → "")
- [x] Dispatch crash recovery (try/catch, error entry, abort cascade)

## Next: Modularization & Dead Code Review

### Goal

TurnExecutor is an orchestrator. It should dispatch to plugins via
hooks and receive results. It should not contain budget math, context
materialization, or recovery state machines. Every concern that has a
plugin home should live there.

### Phase 1: Kill the budget recovery loop

The `advanceRecovery` state machine in `recovery.js` + the recovery
tracking in AgentLoop (`recovery` variable, `if (recovery !== null)
continue`) is superseded by:
- Budget plugin mass-demotes on overflow (already works)
- `error://` entries tell the model what happened (new this session)
- ResponseHealer catches non-progress (cycle/stall detection)

The recovery loop actively harms by disabling safety checks during
recovery. Remove it.

- [ ] Delete `src/plugins/budget/recovery.js`
- [ ] Remove `recovery` variable and `advanceRecovery` from AgentLoop
- [ ] Remove `if (recovery !== null) continue` bypass
- [ ] Remove `budgetRecovery` from TurnExecutor return value
- [ ] Budget 413s become error:// entries (same as other errors)
- [ ] Verify budget E2E tests still pass without recovery loop

### Phase 2: Progress plugin → prompt attributes

- [ ] Add `tokenBudget` and `tokenUsage` attributes to prompt assembly
- [ ] Remove progress plugin (`src/plugins/progress/`)
- [ ] Remove `progress` from PROMPT_SCHEMES in `src/plugins/index.js`
- [ ] Budget warnings → error:// entries (only when exceeded)
- [ ] Update LME system.md benchmark prompt

### Phase 3: Budget code out of TurnExecutor

TurnExecutor currently:
- Materializes context twice (pre-LLM and post-dispatch)
- Calls `budget.enforce` and `budget.postDispatch` directly
- Handles Prompt Demotion inline
- Passes budget results back to AgentLoop

All of this should be budget plugin concern:
- [ ] `budget.enforce` moves to a `turn.started` or `llm.request` hook
- [ ] `budget.postDispatch` moves to a `turn.completed` hook
- [ ] Prompt Demotion moves into budget plugin
- [ ] TurnExecutor drops all budget imports and variables

### Phase 4: Dead code and stale patterns

- [ ] `console.warn`/`console.error` audit — every remaining call
  either becomes an error:// entry or is truly infrastructure logging
- [ ] `COALESCE(ke.scheme, 'file')` in SQL — 3 remaining instances
- [ ] `filePath` variable naming — rename to `entryPath` or `targetPath`
- [ ] `generatePatch(filePath, ...)` parameter naming in matcher.js
- [ ] Stale SPEC.md sections (summarize, old status codes, old history)
- [ ] Stale PLUGINS.md entries
- [ ] Stale FIDELITY_CONTRACT.md references

### Phase 5: E2E reliability

- [ ] All 26+ E2E tests pass consistently
- [ ] Each failure investigated to root cause
- [ ] Persona/fork timeout investigated (120s on trivial question)
- [ ] Budget recovery tests updated for new approach

## Road to Production

### Client handoff
- [ ] CLIENT_CHANGES.md delivered to rummy.nvim team
- [ ] rummy.web published with all session changes
- [ ] rummy.nvim updated for new contract

### Benchmark validation
- [ ] MAB CR full split with current preamble
- [ ] LME oracle split with updated system.md
- [ ] Compare against pre-session baselines

## Published Baselines (MemoryAgentBench, ICLR 2026)

Source: HUST-AI-HYZ/MemoryAgentBench — arXiv 2507.05257

| Model | CR-SH (single-hop) | CR-MH (multi-hop) |
|---|---|---|
| GPT-4o | 60% | **5%** |
| Claude 3.7 Sonnet | 43% | 2% |
| Gemini 2.0 Flash | 30% | 3% |
| Best published | 60% | **6%** |

## Ongoing Development Checklist

- [ ] Perform gemma/mab benchmark run

## Ongoing Development Conversation (ALERT: LLM APPEND CONVERSATIONAL FEEDBACK HERE)

> I wish to perform a short run of gemma/mab to see if we have any benchmark regressions after our long session that's been focused on improving the agent in project/development workflows.


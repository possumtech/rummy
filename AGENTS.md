# AGENTS: Planning & Progress

## Current State

URI-based K/V store (`known://`, `write://`, `summary://`, bare paths for files).
Pattern tools via hedberg (glob/regex/xpath/jsonpath on `path`/`value`, `keys` flag for preview).
Termination protocol: `<update/>` continues, `<summary/>` terminates.
ResponseHealer (stall counter, heal from content). CHECK constraints per scheme.
Web search (SearXNG) and URL fetch (Playwright + Readability + Turndown).
Move/copy across file and K/V namespaces. Write with SEARCH/REPLACE mode.
`turn_context` materialized view via `v_model_context` VIEW + SQL functions
(`countTokens`, `schemeOf`, `langFor`, `tierOf`, `fidelityOf`, `hedberg`).
Generated `scheme` column. `category` column on `turn_context`.
`file_constraints` table for client visibility (project-scoped).
Run state machine trigger on `runs.status`.
Sacred prompts locked (2026-03-31).

### E2E Testing Philosophy

E2E tests are **story-driven**. Each test file begins with a narrative describing
what the user is trying to accomplish — the story. The test succeeds if the story
succeeds, regardless of implementation details.

Assertions target outcomes ("the run completed," "the summary contains a relevant
answer"), not mechanics ("the model used `<read>`," "the entry state is `pass`").
This makes E2E tests immune to refactors that change tool names, schemes, or
internal state — as long as the story still works, the test passes.

When a refactor breaks an E2E test, ask: **did the story break, or did the
assertion?** If the story still works but the assertion checks an implementation
detail, fix the assertion. If the story broke, fix the implementation.

---

## Todo: E2E Story Suite

Replace the current scattered E2E collection with a focused suite of multi-turn
story tests. Each story runs on a **single run** with multiple turns, exercising
tools, verifying model behavior relative to tools, and validating our response
processing. Only Story 1 is single-turn.

Every assertion targets **content and behavior**, not implementation details.
If the model's answer is correct, the test passes — regardless of how many
entries exist, what schemes were used, or what intermediate states occurred.

### Test Infrastructure

Shared `before()`: git-initialized temp project with known files:
- `src/app.js` — Express app on port 8080, TODO comment
- `src/config.json` — `{ "db": "postgres", "pool": 5, "host": "db.internal" }`
- `src/utils.js` — 2 exported functions (`greet()`, `add(a, b)`)
- `notes.md` — "The project codename is: phoenix"
- `data/users.json` — `[{"name":"Alice","role":"admin"},{"name":"Bob","role":"viewer"}]`

### Story 1: Baseline — single-turn factual answer (ask)

**1 turn.** "What is the project codename in notes.md? Reply ONLY with the word."
- Assert: summary/update contains "phoenix"

### Story 2: Multi-turn knowledge building (ask, same run)

**Turn 1:** "Read src/config.json and save the database type as a known entry."
- Assert: run completed, known entry exists with value containing "postgres"

**Turn 2 (continue):** "What database pool size did you find? Reply with the number."
- Assert: response contains "5"
- Validates: multi-turn memory, known entries persist across turns

### Story 3: File editing with SEARCH/REPLACE (act)

**Turn 1:** "In src/app.js, replace the TODO comment with an actual error handler.
Use SEARCH/REPLACE to make the edit."
- Assert: run reaches `proposed` status
- Assert: proposed entry exists for a write:// path

**Turn 2 (resolve accept):** Accept the proposed edit.
- Assert: run resumes and completes
- Assert: the write result has state `pass`

### Story 4: Read → reason → write chain (act)

**Turn 1:** "Read data/users.json. How many admin users are there? Write the count
to known://admin_count."
- Assert: run completes
- Assert: known://admin_count exists with value containing "1"

**Turn 2 (continue):** "Now read src/config.json. What's the database host?
Save it to known://db_host."
- Assert: known://db_host contains "db.internal"
- Validates: model reads files, extracts specific data, writes to known entries

### Story 5: Unknown → investigate → resolve (ask)

**Turn 1:** "What testing framework does this project use? Don't guess — register
what you don't know first."
- Assert: run completes
- Assert: at some point an unknown:// entry existed (or the model investigated)
- Assert: the final response is reasonable (acknowledges uncertainty or investigates)

### Story 6: Pattern operations — glob read (ask)

**Turn 1:** "Read all .js files in src/ using a glob pattern. Which file contains
the word 'express'? Reply with the filename."
- Assert: response contains "app.js"

**Turn 2 (continue):** "Now which file exports a function called 'add'?"
- Assert: response contains "utils.js"
- Validates: glob expansion, model reasoning over multiple file contents

### Story 7: Move and copy (act)

**Turn 1:** "Copy known://admin_count to known://admin_count_backup" (depends on
Story 4's known entries — or seed it fresh)
- Assert: run completes
- Assert: known://admin_count_backup exists

**Turn 2 (continue):** "Move known://admin_count_backup to known://archived_count"
- Assert: known://archived_count exists
- Assert: known://admin_count_backup is gone
- Validates: copy creates duplicate, move removes source

### Story 8: Delete operations (act)

**Turn 1:** "Delete the file notes.md"
- Assert: proposed (file deletion requires approval)

**Turn 2 (resolve reject):** Reject the deletion.
- Assert: run status becomes `resolved` or resumes
- Assert: notes.md entry still exists in the store
- Validates: reject flow, file survives rejection

### Story 9: Env command (act)

**Turn 1:** "Run `node --version` to check the Node.js version."
- Assert: env entry has state `pass` (env auto-passes)
- Assert: model reports the version

**Turn 2 (continue):** "Now run `echo RUMMY_TEST_MARKER` and tell me what it prints."
- Assert: response mentions "RUMMY_TEST_MARKER"
- Validates: env execution, model reads output, multi-turn env

### Story 10: Drop and re-read (ask)

**Turn 1:** "Read src/config.json and tell me the pool size."
- Assert: response contains "5"

**Turn 2 (continue):** "Drop src/config.json from context, then re-read it and
tell me the database host."
- Assert: response contains "db.internal"
- Validates: drop removes from context, re-read restores, model answers from fresh read

### Story 11: Lite mode — no file context (ask)

**Turn 1:** "What is 7 * 13? Reply ONLY with the number." (noContext: true)
- Assert: response contains "91"

**Turn 2 (continue on same run):** "What is the square root of 144? Reply ONLY
with the number."
- Assert: response contains "12"
- Validates: lite mode works, multi-turn works without file context

### Story 12: Abort mid-run (ask)

**Turn 1:** Start a prompt that will take multiple turns: "Carefully read every
file in the project, summarize each one individually, then provide a final summary."
- Send `run/abort` via RPC while the run is active
- Assert: run status transitions to `aborted`
- Validates: abort signal reaches the LLM call, run terminates cleanly

### Story 13: Second question on same run (ask)

**Turn 1:** "What is the project codename? Reply ONLY with the word."
- Assert: response contains "phoenix"

**Turn 2 (new question, same run):** "What port does src/app.js use? Reply ONLY
with the number."
- Assert: response contains "8080" (NOT "phoenix")
- Validates: model answers the NEW question, not the old one. Tests message
  structure — the latest prompt is in `<prompt>`, not buried in history.

### Story 14: Write with naked path (ask)

**Turn 1:** "The answer to life is 42. Save that as a known entry."
- Assert: a known:// entry exists with a slug-derived path
- Assert: value contains "42"
- Validates: naked `<write>content</write>` generates known:// slug path

**Turn 2 (continue):** "What did you save about the answer to life?"
- Assert: response contains "42"
- Validates: model can recall its own known entries

---

## Todo: Relevance Engine

`src/plugins/engine/engine.js` — an `onTurn` hook (priority 20) that manages
context budget and materializes `turn_context`. Runs after file scan and
existing plugins (priority 10), before context assembly (reads `turn_context`).

### Phase 0: Budget Enforcement (the engine) ✓

- [x] **Engine plugin** — `src/plugins/engine/engine.js`, priority 20.
- [x] **Token budget check** — fast `SUM(tokens)` query, early return if under budget.
- [x] **Demotion cascade** — results → file full→symbols → known → file symbols→path.
- [x] **Current-turn protection** — entries at `turn === sequence` are never touched.
- [x] **Demotion report** — injects `inject://` info entry with budget percentages.
- [x] **Schema: tokens split** — `tokens` (context cost) + `tokens_full` (raw value cost).
      All state-changing queries update `tokens`: promote restores to `tokens_full`,
      demote sets to `countTokens(path)`, setFileState(symbols) uses `countTokens(meta.symbols)`.
- [x] **Symbol file query fix** — `get_symbol_files` respects `turn > 0`.
      `get_stored_files` includes demoted symbols files.

### Phase 1: Integration Tests ✓

17 tests in `test/integration/engine.test.js`:

- [x] No-op when under budget / empty store
- [x] Over-budget trimming to fit budget
- [x] Results demoted before files
- [x] Files downgraded to symbols before known entries demoted
- [x] Current-turn protection (single entry + mixed turns)
- [x] Oldest turn first within same tier
- [x] Largest entries first within same turn
- [x] Entry persists in store after demotion
- [x] `tokens_full` preserved after demotion
- [x] Promote restores `tokens` to `tokens_full`
- [x] Demotion report injection + no report when unnecessary
- [x] Symbol file query: turn 0 hidden, turn > 0 visible, demoted in stored files

### turn_context + SQL Refactor ✓

Materialized `turn_context` table replaces the fragmented query pipeline.
SQL functions replace JS classification. File constraints separated from fidelity.

- [x] **turn_context table** — `scheme` (generated), `fidelity` (full/summary/index), `content`, `tokens`
- [x] **v_model_context VIEW** — CTEs + window functions + `fidelityOf()`, `countTokens()`
- [x] **SQL functions** — `countTokens`, `schemeOf`, `langFor`, `tierOf`, `fidelityOf` in `src/sql/functions/`
- [x] **Generated scheme** — `known_entries.scheme` is `GENERATED ALWAYS AS (schemeOf(path)) STORED`
- [x] **file_constraints table** — project-scoped client visibility (`active`/`readonly`/`ignore`)
- [x] **File states simplified** — only `full` and `symbols` in `known_entries` (no client concerns)
- [x] **tokens split** — `tokens` (context cost) + `tokens_full` (raw value cost)
- [x] **CHECK constraints** — all numeric fields, temperature/context_limit bounds, sequence minimums
- [x] **Engine materializes** — `INSERT INTO turn_context SELECT FROM v_model_context` + synthetic rows
- [x] **ContextAssembler** — routes by `scheme` + `fidelity`, constraint labels from `meta.constraint`
- [x] **Deleted** — `getModelContext()`, `getContextDistribution()`, 6 dead queries, `v_turn_history`, `bucketOf`

### Phase 2: Metrics

Instrumentation. Only built after the engine makes decisions worth measuring.
Separate `engine_metrics.db` — engine telemetry never pollutes model state.

- [ ] **Metrics plugin** — `src/plugins/engine/metrics.js`, wraps engine at priority 21.
      Records what the engine did each turn.
- [ ] **Schema** — `runs` and `turn_metrics` tables. Columns driven by actual engine
      signals (tokens before/after, entries demoted, utilization percentage).
- [ ] **Report script** — `test/engine/report.js`, queries metrics DB, prints comparison.

### Phase 3: Ref Counting & Preheat

Optimization to demotion priority. Makes structurally central files resist demotion.

- [ ] **Ref counting** — compute `refs` from `meta.symbols` cross-references. A promoted
      file that imports other files increases their `refs`. High-ref files resist demotion.
- [ ] **Preheat cascade** — when a file is promoted, auto-promote its direct imports at
      `symbols` fidelity. Capped at N entries to prevent budget blowout.

### Phase 4: Decay

Entries promoted but untouched for N turns get demoted automatically.

- [ ] **Turn-based decay** — configurable decay rate per scheme. `known://` decays
      slower than files (knowledge is stickier than code context).
- [ ] **Decay integration** — engine checks age before the budget cascade. Stale entries
      are demoted proactively, not just reactively when over budget.

---

## Todo: Message Structure Refactor

ContextAssembler currently renders everything into a single system message.
Refactor to the two-message architecture documented in ARCHITECTURE.md §3.1:

**System** = `<instructions/>` + `<context/>`
**User** = `<messages/>` + `<prompt/>` or `<progress/>`

- [ ] **Split turn_context into context vs messages** — context entries (files,
      knowledge, unknowns) go in system. Message entries (prompts, tool results,
      updates, summaries) go in user. The `category` column or `schemes.category`
      can drive the split.
- [ ] **Render context in system** — instructions (sacred prompt) + `<context>` tag
      wrapping files, knowledge, unknowns. Ends with unknowns.
- [ ] **Render messages in user** — `<messages>` tag wrapping chronological prompt,
      tool, update, summary entries. Followed by `<prompt>` or `<progress>`.
- [ ] **Prompt vs progress** — `<prompt>` only on turns with genuine user input.
      `<progress>` on continuation turns (ephemeral, stored for audit).
- [ ] **Remove prompt from context ordering** — prompts are no longer ordinal 8
      in v_model_context. They're in messages.
- [ ] **Update v_model_context VIEW** — exclude message-domain entries (results,
      summaries, updates, prompts) from the context view.
- [ ] **Update engine** — continuation injection goes to messages, not context.
- [ ] **Update ContextAssembler** — new `assembleFromTurnContext` builds two
      messages instead of one. Delete legacy `assemble()` if unused.
- [ ] **Update tests** — ContextAssembler tests, engine tests, E2E.

---

## Done: Abort Chain Fix ✓

AbortSignal now threads through the full call chain:
`AgentLoop.controller.signal` → `TurnExecutor.execute({signal})` →
`LlmProvider.completion(msgs, model, {signal})` → all 3 clients →
`AbortSignal.any([runSignal, timeoutSignal])` → `fetch({signal})`.

Startup cleanup: `abort_stuck_runs` query sets all `running`/`queued` runs
to `aborted` on boot. Called in `service.js` after DB hygiene.

- [x] **Thread AbortSignal through the call chain**
- [x] **Startup cleanup**
- [ ] **E2E test** — doom loop + abort story (in E2E story suite below)

### Non-git project file scanner gap

`ProjectContext.getMappableFiles()` returns nothing for non-git directories.
The file scanner only discovers files via `git ls-files`. Non-git projects have
zero files bootstrapped into context on the first run.

- [ ] **Fallback file discovery** — when `isGit` is false, walk the directory
      tree (respecting .gitignore-style patterns or a .rummyignore)
- [ ] **E2E test** — story test with non-git project verifying files are in context

---

## Done: Schemes Table ✓

`schemes` table is the single source of truth. `fidelityOf.js` and `tierOf.js`
deleted. CHECK constraint replaced with validation triggers. Views join schemes
for fidelity, tier, model_visible, and category. Adding a scheme = INSERT.

## Done: Integer Primary Keys ✓

`projects.id`, `sessions.id`, `runs.id` are INTEGER AUTOINCREMENT. UUIDs removed.
All FKs follow. RETURNING on create queries. Aliases remain the external identifier.

---

## Future: Dependency Alternatives

**isomorphic-git** — Pure JS git implementation. Would eliminate all `execSync("git ...")`
subprocess spawns in `GitProvider.js`. Currently `ProjectContext.open()` caches results
keyed on HEAD hash, so the subprocess cost is amortized. Consider adopting if:
(a) git operations expand beyond `ls-files`/`rev-parse`, or (b) we need to run in
environments without git installed.

## Future: Knowledge Graph

Scan `known://*` values for URI references (file paths, `known://`, `https://`).
Build citation edges. High-connectivity knowledge nodes resist demotion. Deferred
until budget enforcement + ref counting are proven.

## Future: Stored Key Compression

Pattern-compress the `stored://` index. Instead of listing `known://users_dave`,
`known://users_bob`, `known://users_stacy` individually, show `known://users_*`.
Reduces noise in an ever-growing key space.

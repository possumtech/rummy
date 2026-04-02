# AGENTS: Planning & Progress

## Current State

Unified `prompt.md` sacred prompt. Mode (ask/act) per-prompt, not per-run.
URI-based K/V store (`known://`, `summary://`, bare paths for files).
Scheme registry: `prompt://` (loop identity), `ask://`, `act://`, `progress://`.
Pattern tools via hedberg (glob/regex/xpath/jsonpath on `path`/`value`, `keys` state for preview).
Termination protocol: `<update/>` continues, `<summary/>` terminates.
Plain text with no tools → healed to summary (run terminates).
Loop defense: repetition detector (`RUMMY_MAX_REPETITIONS`), stall counter (`RUMMY_MAX_STALLS`).
Tool result content composed at write time (rm/mv/cp/env/run/ask_user/search).
Web search (SearXNG) and URL fetch (Playwright + Readability + Turndown).
RPC audit log (`rpc_log` table + console with elapsed time).
Model response diagnostics (`model://` entries with `include_reasoning`).
AbortSignal threaded through AgentLoop → TurnExecutor → LLM clients → fetch.

### E2E Testing Philosophy

Story-driven. Assertions target outcomes, not mechanics. Graceful recovery
is not failure — isolate repeated failures as infrastructure bugs, not model drift.

62/64 E2E pass. 157 unit, 83 integration. Suite runs ~13 minutes with
`--test-force-exit`.

---

## Todo: Remaining from Unified Prompt Architecture

- [ ] **Delete prompt.ask.md, prompt.act.md** — replaced by prompt.md
- [x] **Server-side mode enforcement** — rejects file writes, file deletes, file
      move/copy targets, and `<run>` in ask mode. K/V writes allowed.
- [ ] **ARCHITECTURE.md full pass** — §2, §3, §5 need updating for new scheme names
- [ ] **Prompt carries model** — `prompt://` meta should record model used;
      run has a current/default model that can change

---

## Todo: Remaining from Tool Result Content

- [ ] **Remove `write` scheme** — write acts on target paths directly.
      Successful writes update target value. Failed writes set target to
      `state = 'error'` with error as content. No `write://` entries.
- [ ] **Write to file (error)** — target path: `state = error`, value = error + failed command

## Done: Bulk Operation Results ✓

All pattern operations produce `pattern` state result entries with matched
paths and token counts. Preview operations (dry-run via `preview` attribute)
produce identical entries with `PREVIEW` prefix. Unified `#storeToolResult`
method handles both. `keys` attribute renamed to `preview`, `keys` state
replaced by `pattern`.

---

## Todo: Prompt Queue

All prompts flow through a persistent `prompt_queue` table. The queue IS the
flow — not an exception. RPC handlers INSERT, worker consumes.

```sql
CREATE TABLE prompt_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT
    , run_id INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE
    , session_id INTEGER NOT NULL REFERENCES sessions (id) ON DELETE CASCADE
    , mode TEXT NOT NULL CHECK (mode IN ('ask', 'act'))
    , model TEXT
    , prompt TEXT NOT NULL
    , config JSON
    , status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'completed', 'aborted'))
    , result JSON
    , created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

- One prompt active per run at a time, FIFO
- Abort sets active prompt to `aborted`, pending prompts survive
- Server restart: active → pending, pending retried
- Replaces `#activeRuns` Map, busy-check branching, abort controller access

---

## Todo: Run State Machine v2

All terminal states restartable. Runs are long-lived, typeless.

```
queued    → running, aborted
running   → proposed, completed, failed, aborted
proposed  → running, completed, aborted
completed → running, aborted
failed    → running, aborted
aborted   → running
```

---

## Todo: Relevance Engine

### Phase 2: Metrics

- [ ] Metrics plugin, separate DB, turn-level telemetry

### Phase 3: Ref Counting & Preheat

- [ ] Cross-reference counting from `meta.symbols`
- [ ] Auto-promote imports at symbols fidelity

### Phase 4: Decay

- [ ] Turn-based staleness demotion
- [ ] Configurable decay rate per scheme

---

## Todo: Non-git file scanner

- [ ] Fallback file discovery for non-git projects
- [ ] E2E test with non-git project

---

## Done: OpenRouter Catalog Removed ✓

Bulk `/models` fetch eliminated. `provider_models` table, `ModelCapabilities`,
`refreshCatalog`, `ensureCatalog`, `get_catalog_age` all deleted. Context size
from `RUMMY_CONTEXT_SIZE` env var (default 131072). `include_reasoning: true`
always sent. `getModels` RPC reads env vars only.

# RUMMY: Architecture Specification

This document is the authoritative reference for Rummy's design. The system prompt
files (`system.ask.md`, `system.act.md`) define model-facing behavior. This document
defines everything else: data model, protocol, context management, and testing.

---

## 1. Visibility & Fidelity Model

Rummy controls what the model sees through two orthogonal axes: **promotion**
(who put this file in context?) and **fidelity** (what level of detail does the
model receive?). Promotion is stored. Fidelity is derived at render time.

### 1.1 Promotion

A promotion is a record that a file was placed into context by a specific source.
Promotions are stored in a normalized `file_promotions` junction table. A file can
have zero or more simultaneous promotions from different sources.

| Source   | Set by                   | Lifecycle                              |
|----------|--------------------------|----------------------------------------|
| `client` | Client RPC (`activate`, `readOnly`, `ignore`) | Persistent until client changes it |
| `agent`  | Model `<read>` tag       | Persistent, removed by decay or `<drop>` |
| `editor` | Buffer sync (`projectBufferFiles`) | Transient — cleared and re-synced each turn |

**Client promotions** carry a constraint that determines fidelity:

| Client constraint | Meaning |
|---|---|
| `full` | Full source, editable (`activate`) |
| `full:readonly` | Full source, not editable (`readOnly`) |
| `excluded` | Invisible to model (`ignore`) |

**Agent promotions** carry no constraint. Fidelity is derived from context
(see §1.3). Agent promotions track `last_attention_turn` for decay.

**Editor promotions** carry no constraint. They always resolve to `full:readonly`.

**`drop` RPC** removes the client promotion. The file reverts to its baseline
(agent/editor promotions may still apply). This replaces the old `mappable`
visibility — there is no "mappable" state, only "no client promotion."

### 1.2 Fidelity Levels

Fidelity is never stored. It is computed by `renderPerspective()` each turn.

| Level          | Content in context      | Model can edit? |
|----------------|-------------------------|-----------------|
| `full`         | Complete source         | Yes             |
| `full:readonly`| Complete source         | No              |
| `signatures`   | Symbols/signatures only | No              |
| `path`         | File path exists        | No              |
| `excluded`     | Invisible               | No              |

### 1.3 Fidelity Derivation Rules

Evaluated top-to-bottom. First match wins.

1. **Client `excluded`** → `excluded`. Nothing overrides this.
2. **Client `full:readonly`** → `full:readonly`. Agent `<read>` cannot escalate
   past a client read-only constraint.
3. **Client `full`** → `full`. Immune to decay.
4. **Agent promotion, within decay window** → `full`. The model `<read>` a file
   to work with it and is still actively referencing it. Editable unless rule 2
   applies. A file with no client promotion cannot be `<read>` unless it is
   already in the project map.
5. **Agent promotion, outside decay window** → promotion is **removed**. The file
   reverts to its unpromoted state as if never `<read>`. This is not a downgrade
   to signatures — it is a full revert.
6. **Editor promotion** → `full:readonly`. IDE has the file open. Always full
   source, never editable.
7. **No promotion, symbols extracted** → `signatures`.
8. **No promotion, no symbols or budget exhausted** → `path`.

### 1.4 Attention Decay

Decay is the mechanism by which agent-promoted files lose their promotion when
the model stops referencing them.

- Each turn, the server scans the model's output (content, reasoning, known) for
  words matching file paths or symbol names.
- Any match updates `last_attention_turn` on the agent promotion record.
- When `current_turn - last_attention_turn > RUMMY_DECAY_THRESHOLD`, the agent
  promotion is deleted. The file reverts to its unpromoted baseline.
- `RUMMY_DECAY_THRESHOLD` is defined in `.env` (default: 12 turns).
- Decay only affects agent promotions. Client and editor promotions are immune.

### 1.5 Model-Facing Language

The system prompts (`system.ask.md`, `system.act.md`) use the term **"Retained"**
to describe agent-promoted files. This is intentional — the model does not need to
know about the internal promotion/fidelity machinery. From the model's perspective:

- `<read file="path"/>` → "Marks file as Retained" (creates agent promotion)
- `<drop file="path"/>` → "Unmark file as Retained" (removes agent promotion)

Internal code and documentation use "agent promotion." Model-facing text uses
"Retained." These refer to the same mechanism.

### 1.6 Ranking

Files are ranked for inclusion in the context window by:

1. Promoted files first (any source), ordered by promotion recency.
2. Unpromoted files ordered by heat (symbol cross-references from promoted files).
3. Root-level files get a minor boost.
4. Alphabetical tiebreaker.

The old `is_active` computed column is removed. Ranking queries join against
the `file_promotions` table directly.

### 1.7 Schema

```sql
-- Replaces: is_buffered, is_retained, last_attention_turn, is_active on repo_map_files
CREATE TABLE file_promotions (
    id INTEGER PRIMARY KEY AUTOINCREMENT
    , file_id INTEGER NOT NULL REFERENCES repo_map_files(id) ON DELETE CASCADE
    , source TEXT NOT NULL CHECK (source IN ('client', 'agent', 'editor'))
    , constraint TEXT CHECK (
        (source = 'client' AND constraint IN ('full', 'full:readonly', 'excluded'))
        OR (source != 'client' AND constraint IS NULL)
    )
    , last_attention_turn INTEGER DEFAULT 0
    , created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , UNIQUE (file_id, source)
);
```

The `visibility` column on `repo_map_files` is removed. The `is_buffered`,
`is_retained`, `is_active`, and `last_attention_turn` columns are removed.
All state lives in `file_promotions`.

---

## 2. Context Budget

The context budget controls how many tokens `renderPerspective()` allocates to
the file map within each turn.

### 2.1 Computation

```
budget = floor(contextSize * (RUMMY_MAP_MAX_PERCENT / 100))

if RUMMY_MAP_TOKEN_BUDGET is set:
    budget = min(budget, RUMMY_MAP_TOKEN_BUDGET)
```

- `contextSize` is the model's context window in tokens. Fetched from provider
  metadata on run creation and cached on the run record.
  - OpenRouter: GET `/api/v1/models` → `context_length`
  - Ollama: POST `/api/show` → `model_info.context_length`
- `RUMMY_MAP_MAX_PERCENT` (default: 10): percentage of context window.
- `RUMMY_MAP_TOKEN_BUDGET` (optional): hard cap in tokens. Clamps the
  percent-derived value. If unset, percent alone governs.
- If `contextSize` is unavailable and `RUMMY_MAP_TOKEN_BUDGET` is unset,
  run creation fails with an explicit error. No fallbacks.

### 2.2 Per-Turn Evaluation

Budget is computed every `renderPerspective()` call (once per turn). The budget
and actual token usage are reported in the turn's `usage` object:

```json
{
  "usage": {
    "prompt_tokens": 4200,
    "completion_tokens": 800,
    "context_budget": 12800,
    "context_used": 9400
  }
}
```

### 2.3 Configuration

Defined in `.env`. No magic numbers in code.

```env
RUMMY_MAP_MAX_PERCENT=10        # Primary: percent of model context window
RUMMY_MAP_TOKEN_BUDGET=         # Optional: hard cap in tokens
RUMMY_DECAY_THRESHOLD=12        # Turns before agent promotion decays
```

---

## 3. RPC Protocol

Rummy communicates via JSON-RPC 2.0 over WebSockets. The `discover` RPC method
returns the canonical, machine-readable protocol reference at runtime.

### 3.1 Methods

#### Session Setup

| Method | Params | Description |
|---|---|---|
| `ping` | — | Liveness check. |
| `discover` | — | Returns full method & notification catalog. |
| `init` | `projectPath`, `projectName`, `clientId`, `projectBufferFiles?` | Initialize project and session. |

#### Model Discovery

| Method | Params | Description |
|---|---|---|
| `getModels` | — | List DB models + env aliases. |
| `getOpenRouterModels` | — | List public OpenRouter catalog. |

#### File Visibility

| Method | Params | Description |
|---|---|---|
| `activate` | `pattern` | Add client promotion with `full` constraint. |
| `readOnly` | `pattern` | Add client promotion with `full:readonly` constraint. |
| `ignore` | `pattern` | Add client promotion with `excluded` constraint. |
| `drop` | `pattern` | Remove client promotion. File reverts to baseline. |
| `fileStatus` | `path` | Get file's current promotions and derived fidelity. |
| `getFiles` | — | Get full project tree with visibility. |

#### Run Execution

| Method | Params | Description |
|---|---|---|
| `startRun` | `model?`, `projectBufferFiles?` | Pre-create a run. Returns `runId`. Optional. |
| `ask` | `prompt`, `model?`, `runId?`, `projectBufferFiles?` | Non-mutating query. Auto-creates run if no `runId`. |
| `act` | `prompt`, `model?`, `runId?`, `projectBufferFiles?` | Mutating directive. Auto-creates run if no `runId`. |
| `run/resolve` | `runId`, `resolution` | Resolve a single finding (accept/reject). |
| `run/abort` | `runId` | Abandon run. Discard unresolved findings. |

#### Session Configuration

| Method | Params | Description |
|---|---|---|
| `systemPrompt` | `text` | Set system prompt override. |
| `persona` | `text` | Set agent persona. |
| `skill/add` | `name` | Enable a session skill. |
| `skill/remove` | `name` | Disable a session skill. |

### 3.2 Notifications (Server → Client)

| Notification | Payload | Description |
|---|---|---|
| `run/step/completed` | `runId`, `turn`, `files` | A turn finished. `turn` is the structured turn object. |
| `run/progress` | `runId`, `tasks`, `status` | Agent task status and intermediate state. |
| `ui/render` | `text`, `append` | Streaming output fragment for display. |
| `ui/notify` | `text`, `level` | Toast/status notification. |
| `editor/diff` | `runId`, `file`, `patch` | Proposed file modification. |

### 3.3 Run Lifecycle

A run is an open-ended container for turns sharing conversation history.
Runs do not close. The client can add turns indefinitely.

```
startRun (optional)
    │
    ├──→ ask / act  ──→  turns  ──→  findings
    │                                    │
    │                       run/resolve ─┘  (per finding: accept/reject)
    │                                    │
    │    ◄───────────────────────────────┘  (trigger unblocks, next prompt)
    │
    ├──→ ask / act  ──→  ...  (indefinitely, any mix of ask and act)
    │
    └──→ run/abort  (abandon: discard unresolved findings)
```

**Findings gate**: A SQLite trigger blocks new turn insertion while unresolved
findings exist on the run. The client must resolve all findings before the
agent can continue.

**Who applies diffs to disk?** The client. The server proposes diffs as findings.
The client resolves them (accept/reject) and writes accepted changes to its own
filesystem. The server never touches the working tree.

---

## 4. Core Terminology

| Term        | Definition |
|-------------|------------|
| **Run**     | An open-ended container for turns sharing conversation history. Typed `ask` or `act`. |
| **Turn**    | A single LLM request/response cycle. Stored as an XML tree in the database. |
| **Finding** | A proposed action extracted from a turn: **diff** (edit/create/delete), **command** (run/env), or **notification** (summary/prompt_user). |
| **Promotion** | A record that a file was placed into context by a specific source (client, agent, editor). |
| **Fidelity** | The level of detail the model receives for a file (full, full:readonly, signatures, path, excluded). Derived at render time, never stored. |
| **Decay** | The mechanism by which agent promotions are removed after the model stops referencing a file. |
| **Retained** | Model-facing term for an agent-promoted file (used in system prompts). |
| **Rumsfeld Loop** | The turn cycle: the model must declare `<tasks>`, `<known>`, `<unknown>` before acting. Forces discovery before modification. |

---

## 5. The Rumsfeld Loop

Every turn follows the same cognitive discipline, enforced by protocol validation.

### 5.1 Required Structure

The model must begin every response with three tags in order:

1. `<tasks>` — Checklist of objectives (`- [x]` done, `- [ ]` pending).
2. `<known>` — Facts, analysis, and plans gathered so far.
3. `<unknown>` — What the model still needs to find out. Empty (`<unknown/>`)
   when nothing remains unknown.

This structure is identical in ASK and ACT modes. The system prompts
(`system.ask.md`, `system.act.md`) are the authoritative reference for
model-facing tag definitions.

### 5.2 Exit Conditions

| Condition | Status returned | What happens next |
|---|---|---|
| ASK: `<unknown/>` is empty | `completed` | Model must provide `<summary>`. Run can still receive follow-up turns. |
| ACT: All tasks complete, `<unknown/>` empty | `completed` | Model must provide `<summary>`. |
| Findings produced (diffs, commands) | `proposed` | Trigger blocks next turn until all findings resolved. |
| Unknowns remain, gather tags present | Agent continues | Next turn in the loop. |

### 5.3 Protocol Validation

The server validates each response against mode-specific constraints:

- **Required tags** must be present (tasks, known, unknown).
- **Allowed tags** are mode-dependent (ASK cannot use edit/create/delete/run).
- Violations trigger a retry (up to 5 attempts) with the validation error
  fed back to the model.

---

## 6. Testing

### 6.1 Test Tiers

| Tier | Location | Runner | LLM required? |
|---|---|---|---|
| Unit | `src/**/*.test.js` | `node --test` | No |
| Integration | `test/integration/**/*.test.js` | `node --test` | No |
| E2E | `test/e2e/**/*.test.js` | `node --test` | **Yes** |

### 6.2 E2E Model Requirement

E2E tests execute real turns against a live LLM. This is intentional — the
Rumsfeld Loop's value is in how it constrains real model behavior, which cannot
be verified with mocks.

**Setup:**
1. Install Ollama and pull a local model.
2. Configure `.env.test` with `RUMMY_MODEL_DEFAULT` pointing to that model.
3. Ensure Ollama is running before executing E2E tests.

There is no mock LLM fallback. If the model is unavailable, E2E tests fail.

### 6.3 Coverage Target

80% lines, 80% branches, 80% functions — enforced by `npm test`.

---

## 7. Dead Schema (Removal Targets)

These tables exist in the migration but are not used by the implementation.
They will be removed in the schema migration that introduces `file_promotions`.

| Table | Reason for removal |
|---|---|
| `protocol_constraints` | Protocol validation is hardcoded in AgentLoop. |
| `system_hooks` | Hooks are registered in-memory via HookRegistry. |
| `file_type_handlers` | Extraction routing is hardcoded in SymbolExtractor/CtagsExtractor. |

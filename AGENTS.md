# AGENTS: Planning & Progress

## Current State

### Core Architecture: Entry-Driven Dispatch

Every interaction with the store follows one contract:

```
path (scheme://target)  |  body (tag body)  |  attributes (tag attrs JSON)  |  state
```

The model emits XML tags. The parser produces commands. Every command becomes
a `known_entries` row at `full` state. Registered handlers dispatch against the
scheme and modify the entry (change state, create related entries, perform side
effects). The handler chain is priority-ordered — multiple plugins can hook the
same scheme.

```
Model emits <read path="src/app.js"/>
  → XmlParser produces { name: "read", path: "src/app.js" }
  → TurnExecutor records read://src%2Fapp.js | full | {"path":"src/app.js"} | ""
  → handlers dispatch:
      priority 5: WebPlugin (checks if http URL — no, passes through)
      priority 10: CoreToolsPlugin (promotes file, writes confirmation)
  → entry.created event fires
```

### Columns

| Column | What it holds |
|--------|--------------|
| `path` | `scheme://target` or bare file path |
| `body` | Tag body text. File content for files, tool output for results. |
| `attributes` | Tag attributes as JSON. Handler-private workspace. System never queries into this except via `json_extract` in views. |
| `state` | Lifecycle stage. Determines model visibility. |
| `scheme` | Generated from path. Drives handler dispatch and view routing. |

### States

| State | Model sees | How you get there |
|-------|-----------|-------------------|
| `full` | Complete body | Initial recording, `<read>`, client activate |
| `summary` | Symbols or snippets | Symbol extraction, search results, engine demote |
| `index` | Path listed, no content | Default for new files |
| `stored` | Nothing (retrievable) | `<store>`, engine demote |
| `proposed` | Nothing (pending client) | File writes, `<run>`, `<ask_user>` |
| `pass` | Tool result | Accepted proposal, immediate K/V operations |
| `warn` | Rejection marker | Client rejection |
| `error` | Error detail | Failed operation |
| `info` | Informational | Audit entries, search confirmations, updates |
| `pattern` | Pattern match listing | Glob/regex operations |
| `read` | Read confirmation | Successful `<read>` |

### Tool Registration

```js
hooks.tools.register("search", {
    modes: new Set(["ask", "act"]),
    category: "ask",
    docs: "## <search>...</search>\nSearch the web.",
});

hooks.tools.onHandle("search", async (entry, rummy) => {
    // entry = { scheme, path, body, attributes, state, resultPath }
    // rummy = RummyContext (store, hooks, runId, sequence, etc.)
}, priority);
```

Tools register metadata (modes, category, docs) and handlers separately.
Multiple handlers per scheme, priority-ordered (lower = first). Return
`false` to stop the chain.

### tool:// Entries

Every registered tool materializes as a `tool://name` entry:
- `body` = tool documentation (rendered into system message)
- `attributes` = `{ modes: [...], category: "ask"|"act"|"structural" }`
- Plugins can append docs to other tools' entries (web plugin adds fetch
  docs to `tool://read`)
- Clients discover tools via `<read path="tool://*"/>`

### schemes Table

Bootstrap registry. 29 rows of static config that triggers and views need
at INSERT time. Cannot live in known_entries due to circular dependency
(state validation trigger queries schemes during INSERT). Invisible to
plugins — they interact through `tools.register()` and `tool://` entries.

All result schemes include `full` in valid_states so entries can start at
`full` before handlers set the final state.

---

## Done

### Column Rename ✓

`value` → `body`, `meta` → `attributes` across all SQL, views, queries, JS.
`attributes` has `CHECK (json_valid)` constraint on both tables.

### Recorder/Dispatcher ✓

TurnExecutor is two phases:
1. **Record** — every command → `scheme://slug | full | attributes | body`
2. **Dispatch** — `hooks.tools.dispatch(scheme, entry, rummy)` for each

No tool-specific code in TurnExecutor. All execution logic lives in
handler functions registered by plugins.

### Core Tools as Plugin ✓

`src/plugins/tools/tools.js` registers handlers for all core tools:
`read`, `write`, `store`, `delete`, `move`, `copy`, `run`, `env`, `ask_user`.
Same registration interface as third-party plugins.

### Handler Priority Chain ✓

`hooks.tools.onHandle(scheme, handler, priority)`. Web plugin hooks `read`
at priority 5 to intercept http URLs before core's priority 10 handler.
`return false` stops the chain.

### tool:// Materialization ✓

Engine plugin materializes tool:// entries from ToolRegistry on each turn
(idempotent). Plugin tool docs flow through the store — no special
`prompt.tools` filter.

### Dead Hook Cleanup ✓

Removed: `hooks.action.search`, `hooks.action.fetch`, `hooks.prompt.tools`.
Everything flows through scheme handlers.

### Entry Events ✓

`hooks.entry.created` fires after each command is dispatched. Plugins and
RPC/WS subscribe to the same event.

### Resolution Logic ✓

| Resolution | Model signal | Run outcome |
|-----------|-------------|-------------|
| reject | any | `completed` — rejection stops the bus |
| accept | `<update>` | `running` — model has more work |
| accept | `<summarize>` | `completed` — done |
| accept | neither | `running` — healer decides |
| error | any | `running` ��� fail clock starts |

---

## Todo: Fidelity Projection Hooks

### Problem

The `v_model_context` VIEW hardcodes how entries project at each fidelity
level:

```sql
WHEN fidelity = 'full' THEN body
WHEN fidelity = 'summary' THEN COALESCE(json_extract(attributes, '$.symbols'), body)
```

This means the system decides what `summary` looks like for every entry type.
A file at `summary` shows symbols from attributes. An `https://` entry at
`summary` shows the snippet body. But what about a plugin's custom scheme?
The VIEW has no way to know what `summary` means for `jira://PROJ-123` or
`slack://channel`.

More fundamentally: `attributes` is the handler's workspace. The system
reaching into attributes with `json_extract(attributes, '$.symbols')` to
build the model's view is the system trespassing on plugin-private data.

### Design

Plugins define projection functions for their schemes:

```js
hooks.tools.onProject("myscheme", {
    full: (entry) => entry.body,
    summary: (entry) => entry.attributes?.excerpt || entry.body.slice(0, 200),
    index: (entry) => "",  // path only
});
```

Core schemes register projections the same way. The file scheme's `summary`
projection reads `attributes.symbols`. The https scheme's `summary`
projection returns the snippet body. No hardcoded `json_extract` in the VIEW.

### Implementation Options

**Option A: SQL function**
Register a `project(scheme, fidelity, body, attributes)` SQLite function
that dispatches to JS projection callbacks. The VIEW calls it instead of
the hardcoded CASE. Clean SQL, but ties SQLite function registry to
ToolRegistry.

**Option B: Materialization-time projection**
The engine's `materialize_turn_context` step calls projection functions
in JS before INSERT. The VIEW just stores the pre-projected body. Simpler
SQL, projection logic stays in JS, but adds a JS loop to materialization.

**Option C: Two-column projection**
`known_entries` gains a `projected` column (or `body_summary`) that plugins
populate when they write entries. The VIEW reads the appropriate column
per fidelity level. No function dispatch, but more storage.

### Recommendation

Option B. The engine already loops through entries for budget enforcement.
Adding projection during materialization keeps the logic in JS where
plugins live, and the VIEW stays a simple SELECT. The `attributes` column
remains handler-private — the projection function is the contract between
the plugin and the model's view.

### Dependency

This blocks full use of the `attributes` column for plugin-private data.
Without projection hooks, any data a plugin stores in attributes that the
model should see at `summary` fidelity requires a hardcoded `json_extract`
in the VIEW — which defeats the plugin architecture.

---

## Todo: Schema Restructure — Kill Sessions, Normalize Tables

### Problem

The `sessions` table is a WebSocket connection artifact. Runs belong to
sessions, sessions belong to projects. Closing neovim and reopening creates
a new session, orphaning previous runs. Accessing `run42` from a different
client requires finding the old session ID. The indirection adds no value.

Meanwhile, models are configured via env vars (`RUMMY_MODEL_turboqwen=openai/...`),
run config (temperature, persona) lives on the session instead of the run,
and `ProjectAgent` / `SessionManager` are a redundant delegation layer.

### Target Schema

```sql
projects (
  id, name, project_root, config_path, created_at
)

models (
  id, alias TEXT UNIQUE, actual TEXT, context_length INTEGER,
  is_default BOOLEAN, created_at
)

runs (
  id, project_id, parent_run_id, alias TEXT UNIQUE, status,
  model_id, temperature, persona, context_limit,
  next_turn, created_at
)

file_constraints (
  id, project_id, pattern, visibility, created_at
)

turns (
  id, run_id, sequence, prompt_tokens, completion_tokens,
  total_tokens, cost, created_at
)

known_entries (
  id, run_id, turn, path, body, scheme, state, hash,
  attributes, tokens, tokens_full, refs, write_count,
  created_at, updated_at
)

prompt_queue (
  id, run_id, mode, model_id, prompt, config, status, result, created_at
)

rpc_log (
  id, project_id, method, rpc_id, params, result, error, created_at
)
```

### What Dies

- `sessions` table
- `session_skills` table
- `SessionManager` class (absorbed into ProjectAgent or deleted)
- `sessionId` parameter threading through AgentLoop, TurnExecutor, hooks
- `projectBufferFiles` on ask/act (use `read` with `persist` instead)

### What Moves

| From | To |
|------|----|
| `sessions.temperature` | `runs.temperature` |
| `sessions.persona` | `runs.persona` |
| `sessions.context_limit` | `runs.context_limit` |
| `sessions.system_prompt` | removed (persona covers it) |
| `session_skills` | `project_skills` or removed |
| `runs.session_id` | `runs.project_id` |
| `prompt_queue.session_id` | removed (run_id is sufficient) |
| `rpc_log.session_id` | `rpc_log.project_id` |

### Models Table

Replaces env var configuration. Populated at startup from env (migration
path) or managed via RPC.

```js
// Env vars still work as bootstrap:
// RUMMY_MODEL_turboqwen=openai/Qwen3-14B-TQ-custom
// → INSERT INTO models (alias, actual) VALUES ('turboqwen', 'openai/Qwen3-14B-TQ-custom')
```

Provider routing (`openai/`, `anthropic/`, etc.) parsed from `actual` column.
Context length fetched from provider on first use and cached in the row.

### RPC Changes

| Old | New | Notes |
|-----|-----|-------|
| `init` | `init` | Returns `{ projectId }`, no sessionId |
| `activate` | `read` | `{ path, persist: true }` |
| `readOnly` | `read` | `{ path, persist: true, readonly: true }` |
| `ignore` | `store` | `{ path, persist: true, ignore: true }` |
| `drop` | `store` | `{ path, persist: true, clear: true }` |
| `getFiles` | `getEntries` | `{ pattern: "*", scheme: null }` |
| `fileStatus` | `getEntries` | `{ pattern }` |
| `setTemperature` | run config | Set on run creation or `run/config` |
| `getTemperature` | `getRun` | Temperature is a run property |
| `setContextLimit` | run config | Set on run creation or `run/config` |
| `getContext` | `getRun` + `getModels` | Derived from run's model |
| `systemPrompt` | `persona` on run | One concept, not two |
| `skill/*` | TBD | May move to project level |
| `ask` / `act` | `ask` / `act` | `projectId` context, no sessionId |

### Connection Context

```js
// Old: { projectId, sessionId, projectPath }
// New: { projectId, projectRoot }
```

The WebSocket connection holds project context from `init`. No session
identity. Any client connecting to the same project sees the same runs.
Notifications filter by `projectId` instead of `sessionId`.

### Implementation Order

1. Schema: new migration, nuke DB
2. Models table + env var bootstrap
3. Runs: project_id FK, config columns
4. Kill sessions/SessionManager
5. ProjectAgent absorbs remaining session logic
6. RPC: update init, kill session methods, add run/config
7. ClientConnection: projectId filtering
8. Tests

---

## Todo: Unified Client Interface

See CLIENT.md for the full mapping from old to new RPC interface.

The client speaks the same verbs as the model and plugins:
- `read` / `store` for file visibility (with `persist` flag for constraints)
- `getEntries` for queries
- Run config on run creation, not session-level

---

## Todo: Fidelity Projection Hooks

### Problem

The `v_model_context` VIEW hardcodes how entries project at each fidelity
level:

```sql
WHEN fidelity = 'full' THEN body
WHEN fidelity = 'summary' THEN COALESCE(json_extract(attributes, '$.symbols'), body)
```

This means the system decides what `summary` looks like for every entry type.
A file at `summary` shows symbols from attributes. An `https://` entry at
`summary` shows the snippet body. But what about a plugin's custom scheme?
The VIEW has no way to know what `summary` means for `jira://PROJ-123` or
`slack://channel`.

More fundamentally: `attributes` is the handler's workspace. The system
reaching into attributes with `json_extract(attributes, '$.symbols')` to
build the model's view is the system trespassing on plugin-private data.

### Design

Plugins define projection functions for their schemes:

```js
hooks.tools.onProject("myscheme", {
    full: (entry) => entry.body,
    summary: (entry) => entry.attributes?.excerpt || entry.body.slice(0, 200),
    index: (entry) => "",  // path only
});
```

Core schemes register projections the same way. The file scheme's `summary`
projection reads `attributes.symbols`. The https scheme's `summary`
projection returns the snippet body. No hardcoded `json_extract` in the VIEW.

### Recommendation

Option B: materialization-time projection. The engine calls projection
functions in JS before INSERT into turn_context. The VIEW stays a simple
SELECT. The `attributes` column remains handler-private.

### Dependency

This blocks full use of the `attributes` column for plugin-private data.

---

## Todo: Out-of-Process Plugins

Heavy subsystems as separate services via RPC:
- Web (Playwright, SearXNG) → `rummy.web` repo
- Same `tools.register()` / `tools.onHandle()` contract, different transport

---

## Todo: Remaining Cleanup

- [ ] Delete `prompt.ask.md`, `prompt.act.md` — replaced by `prompt.md`
- [ ] Non-git file scanner fallback
- [ ] ARCHITECTURE.md update for new column names and dispatch architecture

---

## Todo: Relevance Engine (deferred, separate project)

- [ ] Fidelity projection hooks (prerequisite — see above)
- [ ] Metrics plugin, separate DB, turn-level telemetry
- [ ] Symbol extraction sets `summary` state
- [ ] Engine demotion cascade: `full` → `summary` → `index` → `stored`
- [ ] Cross-reference counting, auto-promote imports
- [ ] Turn-based decay via state transitions

---

## Testing

303 unit + integration + live + E2E tests, 0 failures.
Handler dispatch, priority ordering, tool:// materialization all covered.
40 E2E tests pass against real models.

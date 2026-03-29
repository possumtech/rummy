# RUMMY: Architecture Specification

This document is the authoritative reference for Rummy's design. The system prompt
files (`system.ask.md`, `system.act.md`) define model-facing behavior. This document
defines everything else: data model, protocol, context management, and testing.

---

## 1. The Known Store

All model-facing state lives in one table: `known_entries`. Files, knowledge,
tool results, findings, summaries — everything is a keyed entry with a domain
and state. There are no separate findings tables, pending context queues, file
promotion tables, or message history. The known store IS the model's memory.

### 1.1 Schema

```sql
CREATE TABLE known_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT
    , run_id TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE
    , turn_id INTEGER REFERENCES turns (id) ON DELETE CASCADE
    , key TEXT NOT NULL
    , value TEXT NOT NULL DEFAULT ''
    , domain TEXT NOT NULL CHECK (domain IN ('file', 'known', 'result'))
    , state TEXT NOT NULL
    , target TEXT NOT NULL DEFAULT ''
    , tool_call_id TEXT
    , write_count INTEGER NOT NULL DEFAULT 1
    , created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , CHECK (
        (domain = 'file' AND state IN ('full', 'readonly', 'active', 'ignore', 'symbols'))
        OR (domain = 'known' AND state IN ('full', 'stored'))
        OR (domain = 'result' AND state IN ('proposed', 'pass', 'info', 'warn', 'error', 'summary'))
    )
);
```

### 1.2 Domains & States

**File domain** — project files bootstrapped at run start:

| State | Meaning | Model sees |
|-------|---------|------------|
| `full` | Full content, editable | `file` |
| `readonly` | Full content, not editable | `file:readonly` |
| `active` | Client-promoted (editor focus) | `file:active` |
| `ignore` | Excluded from context | *(hidden)* |
| `symbols` | Signature summaries only | `file:symbols` |

**Known domain** — model-emitted knowledge (`/:known/*` keys):

| State | Meaning | Model sees |
|-------|---------|------------|
| `full` | Value loaded | `full` |
| `stored` | Key exists, value not in context | `stored` |

**Result domain** — tool call results (`/:[tool]/*` keys):

| State | Meaning | Model sees |
|-------|---------|------------|
| `proposed` | Awaiting user approval | *(hidden until resolved)* |
| `pass` | Succeeded/accepted | `stored` |
| `info` | Informational notification | `stored` |
| `warn` | Rejected/partial | `stored` |
| `error` | Failed | `stored` |
| `summary` | Summary text | `stored` |

The model sees a simplified projection. The server maps `{domain, state}` to a
model-facing state string at query time. `file:ignore` and `proposed` entries
are hidden from the model entirely.

### 1.3 Key Namespaces

Keys use the `/:` sentinel to distinguish system keys from file paths. No
relative file path starts with `/:`, so the prefix is unambiguous. Regex: `/^\/:/`.

| Prefix | Namespace | Examples |
|--------|-----------|---------|
| *(none)* | File paths | `src/app.js`, `package.json` |
| `/:known/` | Knowledge entries | `/:known/auth_flow`, `/:known/db_adapter` |
| `/:[tool]/` | Tool result keys | `/:read/4`, `/:edit/7`, `/:run/12`, `/:summary/3` |

Result keys use the tool name as prefix and a sequential integer per run.
Tracked by `runs.next_result_seq`.

Knowledge key constraint: `^/:known/[a-z0-9_]+$`. Short lowercase slugs.
Prefer descriptive names over abbreviations.

### 1.4 UPSERT Semantics

The known store uses INSERT OR REPLACE keyed on `(run_id, key)`. Each write
increments `write_count`. Empty value on a `/:known/*` key = delete signal.

### 1.5 State Lock

A trigger blocks new turns while proposed entries exist:

```sql
CREATE TRIGGER lock_turn_on_proposed
BEFORE INSERT ON turns
FOR EACH ROW
BEGIN
    SELECT CASE
        WHEN (SELECT COUNT(*) FROM known_entries
              WHERE run_id = NEW.run_id AND domain = 'result' AND state = 'proposed') > 0
        THEN RAISE(ABORT, 'Blocked: Run has unresolved proposed entries.')
    END;
END;
```

---

## 2. Native Tool Calling

The model communicates exclusively through tool calls. No structured JSON in the
content body. No message history.

### 2.1 Tools

**Shared (ask + act):**

| Tool | Params | Required |
|------|--------|----------|
| `known` | `entries: [{key, value}]` | Yes |
| `summary` | `text: string` (1-80 chars) | Yes |
| `unknown` | `items: string[]` | No |
| `read` | `key: string, reason: string` | No |
| `drop` | `key: string, reason: string` | No |
| `env` | `command: string, reason: string` | No |
| `prompt` | `question: string, options: string[]` | No |

**Act-only (extends shared):**

| Tool | Params |
|------|--------|
| `run` | `command: string, reason: string` |
| `delete` | `key: string, reason: string` |
| `edit` | `file: string, search: string\|null, replace: string` |

Tool definitions live in `src/domain/schema/tools.ask.json` and `tools.act.json`.
All tools use `strict: true` for constrained decoding on supporting providers.

### 2.2 Tool Results

**Known tool result:** `[{key, state, value}]` — the full known index.

**Summary tool result:** `[{tool, target, status, key, value}]` — chronological
log of all tool calls and summaries across the entire run. Built from
`known_entries WHERE domain = 'result' ORDER BY id`.

**Unknown tool result:** The array as received.

**Action tool results:** `{level}: {target} # {result} [/:tool/N]` template.

### 2.3 Namespace Routing

`read`, `drop`, and `delete` accept a `key` parameter and route by prefix:

| Tool | File path key | `/:known/*` key | `/:[tool]/*` key |
|------|---------------|-----------------|------------------|
| `read` | Read from disk, promote to `file:full` | Promote to `known:full` | Promote to `result:pass` (recall) |
| `drop` | Demote to `file:symbols` or `file:stored` | Demote to `known:stored` | Demote to `result:stored` |
| `delete` | Delete from disk, remove entry | Remove entry | Remove entry |

### 2.4 Enforcement Layers

1. **Tool definitions** — `strict: true` constrained decoding on tool argument schemas.
2. **Content suppression** — `tool_choice: "required"` + empty-object `response_format` shim.
3. **Prompt instructions + examples** — system prompt describes tool purposes and constraints.
4. **Server-side validation** — confirms `known` and `summary` present. Rejects and retries.

### 2.5 Server Execution Order

The model emits all tool calls as a parallel batch. The server processes in strict order:

1. **Execute action tools** — `read`, `drop`, `env`, `run`, `delete`, `edit`, `prompt`. Generate result keys (`/:read/1`, `/:edit/2`). Store in known store.
2. **Process unknown** — store as `/:unknown` entry for next turn.
3. **Build known result** — UPSERT model's `/:known/*` entries, query full store.
4. **Build summary result** — store summary entry, query full result-domain log.
5. **Send tool results** — one per tool call, linked by `tool_call_id`.

---

## 3. Model Context

No message history. The model's entire context is assembled each turn from:

1. **System prompt** — role description + behavioral constraints
2. **Known entries** — `[{key, state, value}]` embedded in system prompt as JSON
3. **Unknown list** — previous turn's unknown items
4. **Summary log** — `[{tool, target, status, key, value}]` full run history
5. **User message** — current input

Two messages total: `system` + `user`. The known store and summary log are the
model's memory. They are load-bearing from turn 1.

### 3.1 File Bootstrap

At run start, the server populates `known_entries` from the repo map:

| Source | Domain | State |
|--------|--------|-------|
| Files in context (full content) | `file` | `full` |
| Client-promoted readonly | `file` | `readonly` |
| Client-promoted active | `file` | `active` |
| Client-excluded | `file` | `ignore` |
| Root files or heat-promoted | `file` | `symbols` |
| Everything else | `file` | `symbols` or hidden |

The repo map tables (`repo_map_files`, `repo_map_tags`, `repo_map_references`)
serve as indexing infrastructure for the bootstrap. They are read-only from the
known store's perspective — the known store is what the model sees.

---

## 4. State Scopes

| Scope | Lifetime | Contains |
|-------|----------|----------|
| **Project** | Until deleted or re-indexed | File index, symbols, references |
| **Run** | Open-ended conversation | `known_entries`, turns, turn elements |
| **Turn** | Single LLM request/response | Tool calls and their results |

### 4.1 Project Scope

- `repo_map_files` — file metadata (path, hash, size, symbol_tokens)
- `repo_map_tags` — symbol definitions extracted by ctags
- `repo_map_references` — symbol cross-references for heat calculation

### 4.2 Run Scope

- `known_entries` — the unified state machine. All model-facing state.
- `turns` — turn metadata (sequence, token usage)
- `turn_elements` — turn audit trail (tool calls, reasoning)

---

## 5. RPC Protocol

JSON-RPC 2.0 over WebSockets. The `discover` RPC returns the live protocol reference.

### 5.1 Methods

#### Session Setup

| Method | Params | Description |
|--------|--------|-------------|
| `ping` | — | Liveness check |
| `discover` | — | Returns method & notification catalog |
| `init` | `projectPath`, `projectName`, `clientId`, `projectBufferFiles?` | Initialize project and session |

#### Model Discovery

| Method | Params | Description |
|--------|--------|-------------|
| `getModels` | — | List available model aliases |

#### File Visibility (Project-Scoped)

| Method | Params | Description |
|--------|--------|-------------|
| `activate` | `pattern` | Set file to `file:active` |
| `readOnly` | `pattern` | Set file to `file:readonly` |
| `ignore` | `pattern` | Set file to `file:ignore` |
| `drop` | `pattern` | Remove client constraint |
| `fileStatus` | `path` | Get file's current state |
| `getFiles` | — | Get project tree with states |

#### Run Execution

| Method | Params | Description |
|--------|--------|-------------|
| `ask` | `prompt`, `model?`, `run?`, `projectBufferFiles?`, `noContext?`, `fork?` | Non-mutating query |
| `act` | `prompt`, `model?`, `run?`, `projectBufferFiles?`, `noContext?`, `fork?` | Mutating directive |
| `run/resolve` | `run`, `resolution` | Resolve a proposed entry |
| `run/abort` | `run` | Abandon run |
| `run/rename` | `run`, `name` | Rename a run |
| `run/inject` | `run`, `message` | Inject context |
| `getRuns` | — | List runs for session |

Resolution uses the entry's `key` (e.g., `/:edit/3`), not a finding ID.

#### Session Configuration

| Method | Params | Description |
|--------|--------|-------------|
| `systemPrompt` | `text` | Set system prompt override |
| `persona` | `text` | Set agent persona |
| `skill/add` | `name` | Enable skill |
| `skill/remove` | `name` | Disable skill |
| `getSkills` | — | List active skills |
| `setTemperature` | `temperature` | Set temperature (0-2) |
| `getTemperature` | — | Get temperature |

### 5.2 Notifications

| Notification | Payload | Description |
|---|---|---|
| `run/step/completed` | `run`, `turn`, `files`, `cumulative` | Turn finished |
| `run/progress` | `run`, `turn`, `status` | Turn progress |
| `editor/diff` | `run`, `key`, `type`, `file`, `search`, `replace` | Proposed edit |
| `run/command` | `run`, `key`, `type`, `command` | Proposed command |
| `ui/prompt` | `run`, `key`, `question`, `options` | Model question |
| `ui/render` | `text`, `append` | Streaming output |
| `ui/notify` | `text`, `level` | Notification |

Notifications reference entries by `key`, not by finding ID.

### 5.3 Run Lifecycle

```
ask / act  →  turns  →  tool calls  →  known entries
                                            │
                              run/resolve ──┘ (per entry: accept/reject)
                                            │
         ◄─────────────────────────────────┘ (auto-resume if accepted)
```

Findings gate: the state lock trigger blocks new turns while `proposed` entries
exist. The client resolves each entry by its key.

### 5.4 Run Modes

| Mode | Params | Behavior |
|------|--------|----------|
| **Continue** | `run = <name>` | Same run, same known store |
| **New** | `run` omitted | Fresh run, fresh known store |
| **Lite** | `noContext = true` | No file bootstrap |
| **Fork** | `fork = true` | New run, inherits parent's known store |

---

## 6. Provider Compatibility

| Concern | OpenAI | OpenRouter | Ollama |
|---------|--------|------------|--------|
| `strict: true` | Yes | Provider-dependent | No |
| `tool_choice: "required"` | Yes | Provider-dependent | Not enforced |
| `response_format` shim | Yes | Provider-dependent | No |
| Parallel tool calls | Yes | Provider-dependent | Model-dependent |

Ollama: all constraints are server-side. Arguments returned as parsed objects
(not JSON strings) — the server normalizes both formats.

### 6.1 Provider Configuration

| Prefix | Provider | Env vars |
|--------|----------|----------|
| *(none)* | OpenRouter | `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL` |
| `ollama/` | Ollama | `OLLAMA_BASE_URL` |
| `openai/` | OpenAI-compatible | `OPENAI_BASE_URL`, `OPENAI_API_KEY` |

```env
RUMMY_MODEL_ccp=deepseek/deepseek-chat
RUMMY_MODEL_local=ollama/qwen3:latest
RUMMY_MODEL_DEFAULT=ccp
```

---

## 7. Plugin System

Plugins extend the server through hooks. Core functionality uses the same pattern.
See `PLUGINS.md` for the full plugin guide (to be updated).

Plugin contract: `export default class` with `static register(hooks)`.

Plugin directories (loaded in order):
1. `src/application/plugins/` — internal core
2. `src/plugins/` — bundled
3. `~/.rummy/plugins/` — user-installed

---

## 8. Testing

| Tier | Location | Runner | LLM required? |
|------|----------|--------|---------------|
| Unit | `src/**/*.test.js` | `node --test` | No |
| Integration | `test/integration/**/*.test.js` | `node --test` | No |
| E2E | `test/e2e/**/*.test.js` | `node --test` | **Yes** |

E2E tests execute real turns against a live LLM. **E2E tests must NEVER mock
the LLM.** Coverage target: 80/80/80.

### 8.1 Environment Cascade

1. `.env.example` — load-bearing defaults
2. `.env` — local overrides (API keys, model aliases)
3. `.env.test` / `.env.dev` — mode-specific

Always use `npm run test:*`. Never invoke node directly with a single env file.

---

## 9. Dependencies

| Dependency | Purpose |
|---|---|
| `@possumtech/sqlrite` | SQLite (author's own anti-ORM) |
| `ws` | WebSocket server |

Symbol extraction uses `ctags`. Token counting: `content.length / 4`.

---

## 10. Terminology

| Term | Definition |
|------|------------|
| **Project** | A codebase. Owns file index, symbols, references. |
| **Session** | A client connection. Owns config (persona, system prompt, skills). |
| **Run** | An open-ended conversation. Owns `known_entries` and turns. |
| **Turn** | A single LLM request/response cycle. |
| **Known Entry** | A keyed entry in the unified state machine. Files, knowledge, tool results, findings — everything. |
| **Rumsfeld Loop** | The turn cycle: the model must declare `known`, `unknown`, and `summary` every turn. Forces discovery before modification. |

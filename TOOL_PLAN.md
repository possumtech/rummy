# Tool Migration Plan

Replace the `response_format` JSON schema approach with native tool calling. Merge with Project Condi's known K/V store. Each phase is self-stable — the system works correctly at each checkpoint without requiring subsequent phases.

## Tool Inventory

### Shared (ask + act)

| Tool | Params | Required | Result |
|------|--------|----------|--------|
| `known` | `entries: [{key, value}]` | Yes (tool + response_format) | `[{key, state, value}]` — unified index of all entries |
| `unknown` | `items: string[]` | No | The array as received |
| `summary` | `text: string` | Yes (tool + response_format) | `[{tool, target, status, key, value}]` — chronological log with interleaved summaries |
| `read` | `key: string, reason: string` | No | File contents or key value. Generates `_tool_` key. |
| `drop` | `key: string, reason: string` | No | Confirmation |
| `env` | `command: string, reason: string` | No | stdout/stderr. Generates `_tool_` key. |
| `prompt` | `question: string, options: string[]` | No | Selected option |

### Act-only (extends shared)

| Tool | Params | Required | Result |
|------|--------|----------|--------|
| `run` | `command: string, reason: string` | No | stdout/stderr. Generates `_tool_` key. |
| `delete` | `key: string, reason: string` | No | Confirmation. Generates `_tool_` key. |
| `edit` | `file: string, search: string\|null, replace: string` | No | Confirmation. Generates `_tool_` key. |

### Four-layer enforcement

1. **Tool definitions** — `tools` array with `strict: true`. Constrained decoding enforces argument shapes during token generation. The `tools` array itself restricts which tool names are valid per mode (ask: 7 tools, act: 10).
2. **Content suppression** — `tool_choice: "required"` suppresses content generation (model must call tools). `response_format` set to a null-content shim as an explicit signal to not populate content:
   ```json
   {
     "response_format": {
       "type": "json_schema",
       "json_schema": {
         "name": "empty",
         "strict": true,
         "schema": {
           "type": "object",
           "properties": {},
           "required": [],
           "additionalProperties": false
         }
       }
     }
   }
   ```
   If the model produces content despite `tool_choice: "required"`, it is forced to emit `{}`. Combined, these two settings make content generation wasted work that the model learns to skip.
3. **Prompt instructions + examples** — System prompt describes each tool's purpose, constraints, and includes concrete examples of correct tool call sets.
4. **Server-side validation** — Final gate. Confirms `known` and `summary` are present in `tool_calls`. Ignores `content` entirely. Rejects and retries on violation.

The server reads exclusively from native `tool_calls`. The `content` field is dead — never read, never stored.

### Known entry states

The known tool result `entries` array is a single flat list. Each entry carries a `state` describing what the value contains:

| State | Namespace | Meaning | Value contains |
|-------|-----------|---------|---------------|
| `file` | File | Full file content loaded | Complete file contents |
| `symbols` | File | Signature-level summary | `name(params)` per line |
| `stored` | Any | Key exists, value not in context | Empty string |
| `full` | Knowledge | Knowledge value loaded | The knowledge value |

Example entries:

```json
[
  {"key": "src/app.js", "state": "file", "value": "const app = express();\n..."},
  {"key": "src/config.js", "state": "symbols", "value": "getPort(env)\ngetHost(env)"},
  {"key": "src/utils.js", "state": "stored", "value": ""},
  {"key": "_known_auth_flow", "state": "full", "value": "OAuth2 PKCE"},
  {"key": "_tool_r7x2m", "state": "stored", "value": ""}
]
```

### Key namespaces

| Prefix | Namespace | Examples |
|--------|-----------|---------|
| *(none)* | File paths | `src/app.js`, `package.json` |
| `_known_` | Knowledge entries | `_known_auth_flow`, `_known_db_adapter` |
| `_tool_` | Action tool results | `_tool_r7x2m`, `_tool_f3a1b` |

### Summary tool result (chronological log)

The summary tool result is a flat chronological array of every tool call and summary across all turns. Summaries appear as entries with `status: "summary"`, a blank key, and their full text as the value. Tool calls have abbreviated entries with a `_tool_` key for recall.

```json
[
  {"tool": "read", "target": "src/config.js", "status": "pass", "key": "_tool_r7x2m", "value": ""},
  {"tool": "summary", "target": "", "status": "summary", "key": "", "value": "Reading config to understand routing."},
  {"tool": "edit", "target": "src/config.js", "status": "warn", "key": "_tool_c9d1e", "value": ""},
  {"tool": "run", "target": "npm test", "status": "error", "key": "_tool_x8k4p", "value": ""},
  {"tool": "summary", "target": "", "status": "summary", "key": "", "value": "Port updated but tests failing. Investigating."}
]
```

Status levels: `pass` (success), `info` (informational), `warn` (partial success or rejection), `error` (failure), `summary` (narrative entry).

The model reads the log for narrative context and can `read(_tool_*)` to recall the full result of any past action.

### Action tool result format

Action tool results use the `{level}: {request} # {result} [{key}]` template in the `role: "tool"` message content:

```
info: src/app.js # file retained (247 lines) [_tool_r7x2m]
error: src/missing.js # file not found in project [_tool_f3a1b]
warn: src/app.js # edits rejected by user [_tool_c9d1e]
pass: npm test # exit 0 [_tool_x8k4p]
```

The `tool_call_id` links each result to its originating call. The generated `_tool_` key is stored in the known store as `stored` (full result recallable via `read`).

The `known` tool returns structured JSON (the `{entries, log}` object). `unknown` returns a JSON array.

### Required tool enforcement

**Layers 1-2: Protocol-enforced (OpenAI, strict-capable OpenRouter providers):**

Constrained decoding during token generation — not post-hoc validation:

- `tool_choice: "required"` — model must call tools, content suppressed.
- `strict: true` on tool schemas — tool arguments must match JSON schema exactly.
- `response_format` empty-object shim — if content is produced despite tool_choice, it's forced to `{}`. Explicit signal to skip content generation.

**Layer 3: Prompt-enforced (all providers):**

System prompt instructions and examples reinforce correct behavior for models without constrained decoding.

**Layer 4: Server-enforced (all providers):**

Confirms `known` and `summary` are present in `tool_calls`. Ignores content. Rejects and retries on violation. Load-bearing for Ollama where protocol enforcement is absent.

### Dual namespace routing

`read`, `drop`, and `delete` accept a `key` parameter and route by prefix:

| Tool | File path key | `_known_*` key | `_tool_*` key |
|------|---------------|----------------|---------------|
| `read` | Read from disk, promote to `file` | Promote to `full` | Promote to `full` (recall result) |
| `drop` | Demote to `symbols` if available, else `stored` | Demote to `stored` | Demote to `stored` |
| `delete` | Delete file from disk, remove entry | Remove entry | Remove entry |

---

## Phase 1: Wire Format + Known Structure

Replace `response_format` with `tools` + summary-enforcing `response_format`. Introduce the `{key, state, value}` structure for known results immediately. No persistence changes.

### Changes

**Schema files** — Replace `ask.json` / `act.json` with tool definition arrays:

- `todo[].tool` enum values -> individual tool definitions (`read`, `drop`, `env`, `run`, `delete`)
- `todo[].argument` + `todo[].description` -> tool-specific `key`/`command` + `reason` params
- `edits[]` -> `edit` tool with `file`, `search` (nullable), `replace`
- `known` -> `known` tool, takes `entries: [{key, value}]` (also enforced in `response_format`)
- `unknown` -> `unknown` tool, takes `items: string[]`
- `summary` -> `summary` tool, takes `text: string` (also enforced in `response_format` with 1-80 char constraint)
- `prompt` -> `prompt` tool, takes `question` + `options`

**OpenRouterClient** — Replace the current `response_format` block with dual-enforcement schema (summary + known required) + `tools` array + `tool_choice: "required"`.

**Turn parsing** — Read tool calls from `tool_calls` array (primary data source). Content body (`{"summary": "...", "known": [...]}`) serves as redundant assertion — server can cross-check but reads from tool calls. Each `tool_calls[]` entry has `id`, `function.name`, `function.arguments`.

**Turn storage** — Store tool calls in the existing tree structure: each tool call becomes a child node of the assistant node, keyed by `tool_call_id`.

**Feedback / pending_context** — Tool results flow back as `role: "tool"` messages with `tool_call_id` instead of blockquote-formatted feedback. `pending_context` rows map directly to tool result messages.

**FindingsProcessor** — Reads `tool_calls` from assistant message instead of parsing `todo` from JSON content. Each finding carries its `tool_call_id` for result linkage.

**StateEvaluator** — Checks tool call names instead of `todo[].tool` values. `hasAct` = any tool call with name in `{run, delete, edit}`.

**System prompts** — `system.ask.md` / `system.act.md` drop the JSON schema examples. Tool descriptions live in the tool definitions. System prompts shrink to role description + behavioral constraints.

**Action tool result keys** — Each action tool call generates a `_tool_` key. At this phase, keys are ephemeral (not persisted).

### Self-stable at Phase 1

- Summary is schema-enforced in content body — always present
- `known` tool takes `{key, value}[]`, result is `[{key, state, value}]`
- `summary` tool takes `text`, result is `[{tool, target, status, key, value}]` — log covers current turn only at this phase
- At this phase: known entries echo back what the model sent (all `full`, no persistence)
- `unknown` tool is optional, result is the array as-is
- Action tools generate `_tool_` keys (ephemeral)
- All action tools behave identically to current `todo` execution
- `prompt` blocks until user responds, returns selected option

---

## Phase 2: Persistence

Add persistence for known entries, summaries, and tool call logs. State survives across turns within a session.

### Changes

**Migration** — Add `known_entries` table:

```sql
CREATE TABLE IF NOT EXISTS known_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT
    , run_id TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE
    , key TEXT NOT NULL
    , value TEXT NOT NULL
    , state TEXT NOT NULL DEFAULT 'full'
        CHECK (state IN ('file', 'symbols', 'stored', 'full'))
    , write_count INTEGER NOT NULL DEFAULT 1
    , updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_known_entries_run_key
ON known_entries (run_id, key);
```

**UPSERT semantics** — On each `known` tool call, for each `{key, value}` entry:
- If key is `""`: DELETE the entry
- Otherwise: INSERT OR REPLACE with `state = 'full'` (knowledge entries), incrementing `write_count`

**Action tool result persistence** — Generated `_tool_` keys are persisted with the full result as value, then set to `stored` (recallable via `read`).

**Summary + log persistence** — Summaries (from content body) and tool call records are stored per turn. The known tool result's `log` field returns the accumulated chronological array across all turns in the run.

**Known tool result** — After UPSERT, query all entries for the run and return the unified `[{key, state, value}]` array.

### Self-stable at Phase 2

- Known entries persist across turns within a run
- Action tool results stored as `_tool_` keys, recallable via `read`
- Log provides chronological narrative with interleaved summaries and tool calls
- `write_count` tracks churn for diagnostics

---

## Phase 3: File-Key Unification

Files in context become entries in the known store. The known tool result becomes the single source of truth — files, symbols, action results, and knowledge in one index.

### Changes

**Bootstrap** — At the start of each run, the server creates known entries for all project files:

| Fidelity | State | Value |
|----------|-------|-------|
| File in context (full content) | `file` | File contents |
| Root file or heat-promoted | `symbols` | `name(params)` per line |
| Everything else | `stored` | Empty string |

**Namespace routing** — `read`, `drop`, `delete` route by prefix (`_known_`, `_tool_`, or bare file path).

| Action | File path | `_known_*` key | `_tool_*` key |
|--------|-----------|----------------|---------------|
| `read` | Read from disk, set to `file` | Set to `full` | Set to `full` (recall) |
| `drop` | `file` -> `symbols` if available, else `stored` | Set to `stored` | Set to `stored` |
| `delete` | Delete from disk, remove entry | Remove entry | Remove entry |

**File listing removal** — The separate project file listing is replaced by the known tool result's `entries` array. It IS the file listing, plus knowledge entries, plus tool result keys.

### Self-stable at Phase 3

- Known entries array is the single source of truth for model state
- Three key namespaces coexist: file paths, `_known_*`, `_tool_*`
- Fidelity system maps directly to entry states
- `read`/`drop`/`delete` work uniformly across all namespaces
- No separate file listing, no separate recall/reject tools

---

## Phase 4: Compressed Turn History

Gate: Phases 1-3 must prove reliable in real usage before proceeding.

Replace full assistant turn history with compressed state:

1. **Known entries** — unified `[{key, state, value}]` array
2. **Unknowns** — previous turn's unknown list only
3. **Log** — chronological `[{tool, target, status, key, value}]` covering entire run
4. **Most recent turn** — kept in full for behavioral continuity

Everything before the most recent turn is dropped from message history.

### Changes

**Turn serialization** — `serialize({ forHistory: true })` renders compressed state as a single context block instead of full prior turns.

**Context budget** — The server decides which entries stay `file`/`full` vs get demoted to `symbols` or `stored` based on a token budget. The model uses `read(key)` to promote anything back to `file`/`full`.

### Self-stable at Phase 4

- Context usage drops dramatically
- The model reconstructs working context from entries + log + most recent turn
- `read` promotes any `stored`/`symbols` entry on demand
- The log's `_tool_` keys give the model an audit trail without full history
- Long-running sessions become viable

---

## Provider Compatibility Notes

| Concern | OpenAI | OpenRouter | Ollama |
|---------|--------|------------|--------|
| `tools` array | Yes | Yes (passthrough) | Yes (model-dependent) |
| `strict: true` (constrained decoding) | Yes | Provider-dependent | No |
| `tool_choice: "required"` | Yes | Provider-dependent | Not enforced |
| `response_format` + `tools` coexistence | Yes | Provider-dependent | No |
| Parallel tool calls | Yes (`parallel_tool_calls`) | Provider-dependent | Model-dependent |
| `role: "tool"` messages | Yes | Yes | Yes |
| `tool_call_id` linkage | Yes | Yes | Yes (parsed object, not string) |

**Ollama**: no constrained decoding. `strict`, `tool_choice`, and `response_format` are not enforced. All constraints are server-side.

**Ollama arguments format**: Ollama returns `arguments` as a parsed object, not a JSON string. Handle both (`typeof arguments === "string"` check).

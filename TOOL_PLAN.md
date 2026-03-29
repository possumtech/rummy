# Tool Migration Plan

Replace `response_format` JSON schema with native tool calling. The known K/V store, summary log, and unknown list ARE the model's context — no message history is sent. Each phase is self-stable.

## Tool Inventory

### Shared (ask + act)

| Tool | Params | Required | Result |
|------|--------|----------|--------|
| `known` | `entries: [{key, value}]` | Yes | `[{key, state, value}]` — unified index of all entries |
| `unknown` | `items: string[]` | No | The array as received |
| `summary` | `text: string` | Yes | `[{tool, target, status, key, value}]` — full run log with interleaved summaries |
| `read` | `key: string, reason: string` | No | File contents or key value. Generates result key. |
| `drop` | `key: string, reason: string` | No | Confirmation |
| `env` | `command: string, reason: string` | No | stdout/stderr. Generates result key. |
| `prompt` | `question: string, options: string[]` | No | Selected option |

### Act-only (extends shared)

| Tool | Params | Required | Result |
|------|--------|----------|--------|
| `run` | `command: string, reason: string` | No | stdout/stderr. Generates result key. |
| `delete` | `key: string, reason: string` | No | Confirmation. Generates result key. |
| `edit` | `file: string, search: string\|null, replace: string` | No | Confirmation. Generates result key. |

### Model context (what the model sees each turn)

No message history. The model's entire context is assembled from tool results and system prompt:

1. **System prompt** — brief role description + behavioral constraints
2. **Known entries** — `[{key, state, value}]` from the `known` tool result. Files, symbols, knowledge, and result keys in one index.
3. **Unknown list** — previous turn's unknown items, copied back verbatim
4. **Summary log** — `[{tool, target, status, key, value}]` from the `summary` tool result. Full run history with interleaved summaries.
5. **User message** — the current user input

The known store and summary log are the model's memory. They are load-bearing from turn 1.

### Four-layer enforcement

1. **Tool definitions** — `tools` array with `strict: true`. Constrained decoding enforces argument shapes. The `tools` array restricts valid tool names per mode (ask: 7, act: 10).
2. **Content suppression** — `tool_choice: "required"` suppresses content generation. `response_format` set to empty-object shim as explicit signal to not populate content:
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
   If the model produces content despite `tool_choice: "required"`, it is forced to emit `{}`.
3. **Prompt instructions + examples** — system prompt describes each tool's purpose, constraints, and includes concrete examples of correct tool call sets.
4. **Server-side validation** — confirms `known` and `summary` are present in `tool_calls`. Ignores `content`. Rejects and retries on violation.

The server reads exclusively from `tool_calls`. The `content` field is dead.

### Known entry states

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
  {"key": "/:known/auth_flow", "state": "full", "value": "OAuth2 PKCE"},
  {"key": "/:read/4", "state": "stored", "value": ""}
]
```

### Key namespaces

| Prefix | Namespace | Examples |
|--------|-----------|---------|
| *(none)* | File paths | `src/app.js`, `package.json` |
| `/:known/` | Knowledge entries | `/:known/auth_flow`, `/:known/db_adapter` |
| `/:[tool]/` | Action tool results | `/:read/4`, `/:edit/7`, `/:run/12`, `/:env/3`, `/:delete/15` |

Result keys use the tool name as prefix and a sequential integer per run: `/:read/1`, `/:read/2`, `/:edit/3`, etc. Self-documenting — you can see which tool produced the result at a glance.

### Summary tool result (chronological log)

Flat chronological array of every tool call and summary across the entire run. Summaries appear with `status: "summary"`, blank key, full text as value. Tool calls have abbreviated entries with result keys for recall.

```json
[
  {"tool": "read", "target": "src/config.js", "status": "pass", "key": "/:read/1", "value": ""},
  {"tool": "summary", "target": "", "status": "summary", "key": "", "value": "Reading config to understand routing."},
  {"tool": "edit", "target": "src/config.js", "status": "warn", "key": "/:edit/2", "value": ""},
  {"tool": "run", "target": "npm test", "status": "error", "key": "/:run/3", "value": ""},
  {"tool": "summary", "target": "", "status": "summary", "key": "", "value": "Port updated but tests failing. Investigating."}
]
```

Status levels: `pass`, `info`, `warn`, `error`, `summary`.

### Action tool result format

Action tool results use the `{level}: {target} # {result} [{key}]` template in the `role: "tool"` message content:

```
pass: src/app.js # file retained (247 lines) [/:read/1]
error: src/missing.js # file not found in project [/:read/2]
warn: src/app.js # edits rejected by user [/:edit/3]
pass: npm test # exit 0 [/:run/4]
```

The `tool_call_id` links each result to its originating call. The generated result key is stored in the known store as `stored` (full result recallable via `read`).

The `known` tool returns a JSON array. `unknown` returns a JSON array. `summary` returns a JSON array.

### Server execution order

The model emits all tool calls as a parallel batch. The server processes them in strict order:

1. **Execute action tools** — `read`, `drop`, `env`, `run`, `delete`, `edit`, `prompt`. Generate result keys (`/:read/1`, `/:edit/2`, etc.). Store full results in the known store as `stored`.
2. **Process `unknown`** — store for injection into next turn.
3. **Build `known` result** — UPSERT the model's `known` entries, then query the full store. Result includes file keys, `/:known/*` entries, and all `/:[tool]/*` result keys generated in step 1.
4. **Build `summary` result** — append this turn's tool call records and summary text to the run log. Return the full accumulated log.
5. **Send all `role: "tool"` results** — one per tool call, linked by `tool_call_id`.

### Dual namespace routing

`read`, `drop`, and `delete` accept a `key` parameter and route by prefix:

| Tool | File path key | `/:known/*` key | `/:[tool]/*` key |
|------|---------------|----------------|-----------------|
| `read` | Read from disk, promote to `file` | Promote to `full` | Promote to `full` (recall result) |
| `drop` | Demote to `symbols` if available, else `stored` | Demote to `stored` | Demote to `stored` |
| `delete` | Delete file from disk, remove entry | Remove entry | Remove entry |

---

## Phase 1: Full Architecture

Native tool calling + known K/V store with file bootstrapping + summary log + no message history. This is the target architecture, not a stepping stone.

### Changes

**Schema files** — Replace `ask.json` / `act.json` with tool definition arrays.

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
CREATE UNIQUE INDEX IF NOT EXISTS idx/:known/entries/:run/key
ON known_entries (run_id, key);
```

Add summary/log persistence table:

```sql
CREATE TABLE IF NOT EXISTS run_log (
	id INTEGER PRIMARY KEY AUTOINCREMENT
	, run_id TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE
	, turn_id INTEGER NOT NULL REFERENCES turns (id) ON DELETE CASCADE
	, tool TEXT NOT NULL
	, target TEXT NOT NULL DEFAULT ''
	, status TEXT NOT NULL CHECK (status IN ('pass', 'info', 'warn', 'error', 'summary'))
	, key TEXT NOT NULL DEFAULT ''
	, sequence INTEGER NOT NULL
	, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx/:run/log_run
ON run_log (run_id, sequence);
```

Add `tool_call_id` columns to existing tables:

```sql
ALTER TABLE pending_context ADD COLUMN tool_call_id TEXT;
ALTER TABLE findings_diffs ADD COLUMN tool_call_id TEXT;
ALTER TABLE findings_commands ADD COLUMN tool_call_id TEXT;
ALTER TABLE findings_notifications ADD COLUMN tool_call_id TEXT;
```

Add `next_result_seq` column to runs (tracks sequential result key counter):

```sql
ALTER TABLE runs ADD COLUMN next_result_seq INTEGER NOT NULL DEFAULT 1;
```

**File bootstrapping** — At run start, create known entries for all project files:

| Fidelity | State | Value |
|----------|-------|-------|
| File in context (full content) | `file` | File contents |
| Root file or heat-promoted | `symbols` | `name(params)` per line |
| Everything else | `stored` | Empty string |

**OpenRouterClient** — Replace `response_format` block with empty-object shim + `tools` array + `tool_choice: "required"`. Strip schema-in-system-prompt injection.

**Turn serialization** — No message history. Each turn sends: system prompt, known result (from previous turn or bootstrap), unknown list (from previous turn), summary log (accumulated), user message.

**Turn parsing** — Read tool calls from `tool_calls` array. Ignore `content`.

**Turn storage** — Tool calls stored as `turn_element` children of the assistant node.

**Feedback / pending_context** — Tool results flow as `role: "tool"` messages with `tool_call_id`. No more blockquote feedback.

**FindingsProcessor** — Reads `tool_calls` from assistant message. Each finding carries its `tool_call_id`.

**StateEvaluator** — Checks tool call names. `hasAct` = any tool call in `{run, delete, edit}`.

**System prompts** — Shrink to role description + behavioral constraints. Tool descriptions live in tool definitions.

**v_turn_history view** — Replace or drop. Turn history is no longer sent to the model. The view may still be useful for debugging/UI.

### Self-stable at Phase 1

- Known store is the model's memory. Files, knowledge, and tool results in one index.
- Summary log is the model's narrative. Full run history with interleaved summaries.
- Unknown list is the model's uncertainty boundary. Ephemeral, re-articulated each turn.
- No message history. Context is assembled from tool results + system prompt.
- The fidelity system (`file`/`symbols`/`stored`/`full`) maps directly to known entry states.
- `read`/`drop`/`delete` work uniformly across all key namespaces.

---

## Phase 2: Context Budgeting

Gate: Phase 1 must prove reliable in real usage.

The server actively manages which entries stay `file`/`full` vs get demoted to `symbols`/`stored` based on a token budget.

### Changes

**Budget enforcement** — Before building the known result, the server checks total token usage of `file`/`full` entries. Entries exceeding the budget are demoted: `file` -> `symbols` if available, else `stored`. `full` -> `stored`. Most recently accessed entries are kept.

**Model-driven promotion** — The model uses `read(key)` to promote any `stored`/`symbols` entry back to `file`/`full`. The budget is re-evaluated next turn.

### Self-stable at Phase 2

- Long-running sessions stay within context limits
- The model sees what it needs (recent/relevant entries at full fidelity)
- Everything else is discoverable via the key index and promotable via `read`

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

**Ollama**: no constrained decoding. All constraints are server-side.

**Ollama arguments format**: Ollama returns `arguments` as a parsed object, not a JSON string. Handle both (`typeof arguments === "string"` check).

# Phase 1: Full Architecture

Native tool calling + known K/V store with file bootstrapping + summary log + no message history. The known store, summary log, and unknown list ARE the model's context.

## Enforcement Layers

1. **Tool definitions** — `tools` array with `strict: true` on each tool schema. Constrained decoding enforces argument shapes. The `tools` array restricts valid tool names per mode (ask: 7, act: 10).
2. **Content suppression** — `tool_choice: "required"` suppresses content. `response_format` set to empty-object shim as explicit signal to not populate content.
3. **Prompt instructions + examples** — system prompt describes each tool's purpose, constraints, and includes concrete examples of correct tool call sets.
4. **Server-side validation** — confirms `known` and `summary` are present in `tool_calls`. Ignores `content`. Rejects and retries on violation.

## API Request Shape

```json
{
  "model": "...",
  "messages": [...],
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
  },
  "tools": [...],
  "tool_choice": "required"
}
```

`tool_choice: "required"` forces tool calls and suppresses content. The `response_format` shim forces any produced content to `{}`. The server reads exclusively from `tool_calls` and never touches `content`.

## Model Context (what the model sees each turn)

No message history. Assembled from tool results and system prompt:

1. **System prompt** — brief role description + behavioral constraints
2. **Known entries** — `[{key, state, value}]` from previous turn's `known` result (or file bootstrap on first turn)
3. **Unknown list** — previous turn's unknown items, copied back verbatim
4. **Summary log** — `[{tool, target, status, key, value}]` accumulated across entire run
5. **User message** — current user input

## Tools

### `known` (shared, required)

Model emits its accumulated facts and analysis as keyed entries.

```json
{
  "type": "function",
  "function": {
    "name": "known",
    "description": "Emit known facts, analysis, and conclusions as keyed entries. Required every turn.",
    "strict": true,
    "parameters": {
      "type": "object",
      "required": ["entries"],
      "additionalProperties": false,
      "properties": {
        "entries": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["key", "value"],
            "additionalProperties": false,
            "properties": {
              "key": { "type": "string", "description": "Key name. Knowledge keys use /:known/ prefix. Empty string to delete." },
              "value": { "type": "string", "description": "The knowledge value." }
            }
          }
        }
      }
    }
  }
}
```

**Result:** `[{key, state, value}]` — the full known index. Includes file keys, `/:known/*` entries, and all `/:[tool]/*` result keys.

### `summary` (shared, required)

Model emits a one-liner status update or answer.

```json
{
  "type": "function",
  "function": {
    "name": "summary",
    "description": "One-liner status update or answer. Required every turn. Max 80 characters.",
    "strict": true,
    "parameters": {
      "type": "object",
      "required": ["text"],
      "additionalProperties": false,
      "properties": {
        "text": { "type": "string", "minLength": 1, "maxLength": 80 }
      }
    }
  }
}
```

**Result:** `[{tool, target, status, key, value}]` — chronological log of all tool calls and summaries across the entire run.

### `unknown` (shared, optional)

Model articulates its uncertainty boundary.

```json
{
  "type": "function",
  "function": {
    "name": "unknown",
    "description": "Things you still need to find out.",
    "strict": true,
    "parameters": {
      "type": "object",
      "required": ["items"],
      "additionalProperties": false,
      "properties": {
        "items": {
          "type": "array",
          "items": { "type": "string" },
          "minItems": 1
        }
      }
    }
  }
}
```

**Result:** the array as received.

### `read` (shared)

```json
{
  "type": "function",
  "function": {
    "name": "read",
    "description": "Load a key's value into context. Key is a relative file path (src/app.js), a /:known/ entry, or a /:[tool]/ result.",
    "strict": true,
    "parameters": {
      "type": "object",
      "required": ["key", "reason"],
      "additionalProperties": false,
      "properties": {
        "key": { "type": "string", "description": "Relative file path, /:known/ key, or /:[tool]/ key." },
        "reason": { "type": "string", "description": "Why this key is needed." }
      }
    }
  }
}
```

**Result:** `pass: {key} # file retained ({N} lines) [/:read/{N}]`

### `drop` (shared)

```json
{
  "type": "function",
  "function": {
    "name": "drop",
    "description": "Demote a key from context. Key is a relative file path, /:known/ entry, or /:[tool]/ result.",
    "strict": true,
    "parameters": {
      "type": "object",
      "required": ["key", "reason"],
      "additionalProperties": false,
      "properties": {
        "key": { "type": "string", "description": "Relative file path, /:known/ key, or /:[tool]/ key." },
        "reason": { "type": "string", "description": "Why this is no longer relevant." }
      }
    }
  }
}
```

**Result:** `pass: {key} # dropped`

### `env` (shared)

```json
{
  "type": "function",
  "function": {
    "name": "env",
    "description": "Run a read-only shell command to explore the environment (ls, grep, git log, etc).",
    "strict": true,
    "parameters": {
      "type": "object",
      "required": ["command", "reason"],
      "additionalProperties": false,
      "properties": {
        "command": { "type": "string", "description": "Shell command to execute (read-only)." },
        "reason": { "type": "string", "description": "What information this gathers." }
      }
    }
  }
}
```

**Result:** `pass: {command} # exit 0 [/:env/{N}]` or `error: {command} # exit {code} [/:env/{N}]`

### `prompt` (shared)

```json
{
  "type": "function",
  "function": {
    "name": "prompt",
    "description": "Ask the user a multiple choice question.",
    "strict": true,
    "parameters": {
      "type": "object",
      "required": ["question", "options"],
      "additionalProperties": false,
      "properties": {
        "question": { "type": "string" },
        "options": { "type": "array", "items": { "type": "string" }, "minItems": 2 }
      }
    }
  }
}
```

**Result:** `info: {question} # {selected option}`

### `run` (act only)

```json
{
  "type": "function",
  "function": {
    "name": "run",
    "description": "Run a shell command that changes the environment (npm install, mkdir, etc).",
    "strict": true,
    "parameters": {
      "type": "object",
      "required": ["command", "reason"],
      "additionalProperties": false,
      "properties": {
        "command": { "type": "string", "description": "Shell command to execute." },
        "reason": { "type": "string", "description": "What this command accomplishes." }
      }
    }
  }
}
```

**Result:** `pass: {command} # exit 0 [/:run/{N}]` or `error: {command} # exit {code} [/:run/{N}]`

### `delete` (act only)

```json
{
  "type": "function",
  "function": {
    "name": "delete",
    "description": "Delete a key. Removes file from disk if key is a file path, removes entry if /:known/ or /:[tool]/ key.",
    "strict": true,
    "parameters": {
      "type": "object",
      "required": ["key", "reason"],
      "additionalProperties": false,
      "properties": {
        "key": { "type": "string", "description": "Relative file path, /:known/ key, or /:[tool]/ key." },
        "reason": { "type": "string", "description": "Why this should be deleted." }
      }
    }
  }
}
```

**Result:** `pass: {key} # deleted [/:delete/{N}]`

### `edit` (act only)

```json
{
  "type": "function",
  "function": {
    "name": "edit",
    "description": "Create or modify a file. Do not describe changes in known/summary — put them here.",
    "strict": true,
    "parameters": {
      "type": "object",
      "required": ["file", "search", "replace"],
      "additionalProperties": false,
      "properties": {
        "file": { "type": "string", "description": "File path to modify or create." },
        "search": { "type": ["string", "null"], "description": "Exact text to find and replace. Null when creating a new file or overwriting entirely." },
        "replace": { "type": "string", "description": "Replacement text, or full content for new files." }
      }
    }
  }
}
```

**Result:** `pass: {file} # edit applied [/:edit/{N}]` or `warn: {file} # edits rejected by user [/:edit/{N}]`

## Tables

### `known_entries` (new)

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

### `run_log` (new)

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
CREATE INDEX IF NOT EXISTS idx_run_log_run
ON run_log (run_id, sequence);
```

### `runs` (modified)

```sql
ALTER TABLE runs ADD COLUMN next_result_seq INTEGER NOT NULL DEFAULT 1;
```

### `pending_context` (modified)

```sql
ALTER TABLE pending_context ADD COLUMN tool_call_id TEXT;
```

### `findings_diffs`, `findings_commands`, `findings_notifications` (modified)

```sql
ALTER TABLE findings_diffs ADD COLUMN tool_call_id TEXT;
ALTER TABLE findings_commands ADD COLUMN tool_call_id TEXT;
ALTER TABLE findings_notifications ADD COLUMN tool_call_id TEXT;
```

### `turn_elements` (modified usage)

Tool calls stored as children of the assistant node. Content is dead — not stored.

```
turn (tag_name='turn')
  └─ assistant (tag_name='assistant')
       ├─ tool_call (tag_name='tool_call')
       │    content: NULL
       │    attributes: {"id": "call_abc", "name": "read", "arguments": "{...}"}
       │
       ├─ tool_call (tag_name='tool_call')
       │    content: NULL
       │    attributes: {"id": "call_def", "name": "known", "arguments": "{...}"}
       │
       └─ ...
```

### `v_turn_history` (view — drop or replace)

Turn history is no longer sent to the model. The view may still be useful for debugging/UI but is no longer part of the critical path.

## Server Execution Order

The model emits all tool calls as a parallel batch. The server processes in strict order:

1. **Execute action tools** — `read`, `drop`, `env`, `run`, `delete`, `edit`, `prompt`. Generate result keys (`/:read/1`, `/:edit/2`, etc.). Store full results in the known store as `stored`.
2. **Process `unknown`** — store for injection into next turn.
3. **Build `known` result** — UPSERT the model's `known` entries (increment `write_count`), then query the full store. Result includes all file keys, `/:known/*` entries, and `/:[tool]/*` result keys.
4. **Build `summary` result** — append this turn's tool call records and summary text to `run_log`. Return the full accumulated log for the run.
5. **Send all `role: "tool"` results** — one per tool call, linked by `tool_call_id`.

## Examples

### Example 1: Ask mode — first turn, model reads files

**Model response:**

```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call_001",
      "type": "function",
      "function": {
        "name": "known",
        "arguments": "{\"entries\":[{\"key\":\"/:known/framework\",\"value\":\"Express with passport middleware\"}]}"
      }
    },
    {
      "id": "call_002",
      "type": "function",
      "function": {
        "name": "read",
        "arguments": "{\"key\":\"src/config.js\",\"reason\":\"Check auth configuration\"}"
      }
    },
    {
      "id": "call_003",
      "type": "function",
      "function": {
        "name": "read",
        "arguments": "{\"key\":\"src/routes/auth.js\",\"reason\":\"Understand auth endpoints\"}"
      }
    },
    {
      "id": "call_004",
      "type": "function",
      "function": {
        "name": "unknown",
        "arguments": "{\"items\":[\"Which session store is configured\",\"Whether tokens are rotated\"]}"
      }
    },
    {
      "id": "call_005",
      "type": "function",
      "function": {
        "name": "summary",
        "arguments": "{\"text\":\"Reading config and routes to understand the auth flow.\"}"
      }
    }
  ]
}
```

**Server execution order:**

Step 1 — execute action tools, generate result keys:
- `read(src/config.js)` → `/:read/1`, stored in known as `stored`
- `read(src/routes/auth.js)` → `/:read/2`, stored in known as `stored`

Step 2 — process unknown:
- Store `["Which session store is configured", "Whether tokens are rotated"]` for next turn

Step 3 — build known result (UPSERT `/:known/framework`, then query full store):

```json
{"role": "tool", "tool_call_id": "call_001", "content": "[{\"key\":\"src/app.js\",\"state\":\"symbols\",\"value\":\"createApp()\\nlisten(port)\"},{\"key\":\"src/config.js\",\"state\":\"file\",\"value\":\"const config = {\\n  port: 3000,\\n  ...\"},{\"key\":\"src/routes/auth.js\",\"state\":\"file\",\"value\":\"router.post('/login', ...\"},{\"key\":\"src/utils.js\",\"state\":\"stored\",\"value\":\"\"},{\"key\":\"/:known/framework\",\"state\":\"full\",\"value\":\"Express with passport middleware\"},{\"key\":\"/:read/1\",\"state\":\"stored\",\"value\":\"\"},{\"key\":\"/:read/2\",\"state\":\"stored\",\"value\":\"\"}]"}
```

Step 1 results — action tool responses:

```json
{"role": "tool", "tool_call_id": "call_002", "content": "pass: src/config.js # file retained (89 lines) [/:read/1]"}
```

```json
{"role": "tool", "tool_call_id": "call_003", "content": "pass: src/routes/auth.js # file retained (156 lines) [/:read/2]"}
```

Step 2 result — unknown response:

```json
{"role": "tool", "tool_call_id": "call_004", "content": "[\"Which session store is configured\",\"Whether tokens are rotated\"]"}
```

Step 4 — build summary log:

```json
{"role": "tool", "tool_call_id": "call_005", "content": "[{\"tool\":\"read\",\"target\":\"src/config.js\",\"status\":\"pass\",\"key\":\"/:read/1\",\"value\":\"\"},{\"tool\":\"read\",\"target\":\"src/routes/auth.js\",\"status\":\"pass\",\"key\":\"/:read/2\",\"value\":\"\"},{\"tool\":\"summary\",\"target\":\"\",\"status\":\"summary\",\"key\":\"\",\"value\":\"Reading config and routes to understand the auth flow.\"}]"}
```

### Example 2: Act mode — edit + run

**Model response:**

```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call_010",
      "type": "function",
      "function": {
        "name": "known",
        "arguments": "{\"entries\":[{\"key\":\"/:known/port_change\",\"value\":\"3000 -> 8080 in src/config.js\"}]}"
      }
    },
    {
      "id": "call_011",
      "type": "function",
      "function": {
        "name": "edit",
        "arguments": "{\"file\":\"src/config.js\",\"search\":\"port: 3000\",\"replace\":\"port: 8080\"}"
      }
    },
    {
      "id": "call_012",
      "type": "function",
      "function": {
        "name": "run",
        "arguments": "{\"command\":\"npm test\",\"reason\":\"Verify port change doesn't break tests\"}"
      }
    },
    {
      "id": "call_013",
      "type": "function",
      "function": {
        "name": "summary",
        "arguments": "{\"text\":\"Changing port to 8080 and running tests.\"}"
      }
    }
  ]
}
```

**Server sends results (user accepts edit, test fails):**

```json
{"role": "tool", "tool_call_id": "call_010", "content": "[{\"key\":\"src/config.js\",\"state\":\"file\",\"value\":\"...\"},{\"key\":\"/:known/port_change\",\"state\":\"full\",\"value\":\"3000 -> 8080 in src/config.js\"},{\"key\":\"/:edit/3\",\"state\":\"stored\",\"value\":\"\"},{\"key\":\"/:run/4\",\"state\":\"stored\",\"value\":\"\"}]"}
```

```json
{"role": "tool", "tool_call_id": "call_011", "content": "pass: src/config.js # edit applied [/:edit/3]"}
```

```json
{"role": "tool", "tool_call_id": "call_012", "content": "error: npm test # exit 1 [/:run/4]"}
```

```json
{"role": "tool", "tool_call_id": "call_013", "content": "[{\"tool\":\"read\",\"target\":\"src/config.js\",\"status\":\"pass\",\"key\":\"/:read/1\",\"value\":\"\"},{\"tool\":\"read\",\"target\":\"src/routes/auth.js\",\"status\":\"pass\",\"key\":\"/:read/2\",\"value\":\"\"},{\"tool\":\"summary\",\"target\":\"\",\"status\":\"summary\",\"key\":\"\",\"value\":\"Reading config and routes to understand the auth flow.\"},{\"tool\":\"edit\",\"target\":\"src/config.js\",\"status\":\"pass\",\"key\":\"/:edit/3\",\"value\":\"\"},{\"tool\":\"run\",\"target\":\"npm test\",\"status\":\"error\",\"key\":\"/:run/4\",\"value\":\"\"},{\"tool\":\"summary\",\"target\":\"\",\"status\":\"summary\",\"key\":\"\",\"value\":\"Changing port to 8080 and running tests.\"}]"}
```

Note: the summary log spans the entire run — it includes entries from Example 1 (turn 1) and this turn (turn 2).

### Example 3: Act mode — edit rejected by user

```json
{"role": "tool", "tool_call_id": "call_021", "content": "warn: src/middleware/auth.js # edits rejected by user [/:edit/5]"}
```

The model sees `warn` in the summary log and can `read(/:edit/5)` to recall the full rejection details.

### Example 4: Ask mode — nothing unknown

Model calls only `known` and `summary`. No `unknown` tool call. Valid — `unknown` is optional.

```json
{"role": "tool", "tool_call_id": "call_030", "content": "[{\"key\":\"/:known/db\",\"state\":\"full\",\"value\":\"SQLite via @possumtech/sqlrite\"}]"}
```

```json
{"role": "tool", "tool_call_id": "call_031", "content": "[{\"tool\":\"summary\",\"target\":\"\",\"status\":\"summary\",\"key\":\"\",\"value\":\"The project uses SQLite via @possumtech/sqlrite.\"}]"}
```

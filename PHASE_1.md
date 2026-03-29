# Phase 1: Wire Format + Known Structure

Replace `response_format` JSON schema with native tool calling. Introduce `{key, state, value}` known structure. No persistence changes — everything is ephemeral within the turn.

## Enforcement Layers

1. **Tool definitions** — `tools` array with `strict: true` on each tool schema. Constrained decoding enforces argument shapes. The `tools` array itself restricts which tool names are valid per mode (ask: 7, act: 10).
2. **Content suppression** — `tool_choice: "required"` suppresses content generation. `response_format` set to empty-object shim as explicit signal to not populate content.
3. **Prompt instructions + examples** — System prompt describes each tool's purpose, constraints, and includes concrete examples of correct tool call sets.
4. **Server-side validation** — Confirms `known` and `summary` are present in `tool_calls`. Ignores `content` entirely. Rejects and retries on violation.

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

`tool_choice: "required"` forces tool calls and suppresses content. The `response_format` shim forces any produced content to `{}` — an explicit signal that content generation is wasted work. The server reads exclusively from `tool_calls` and never touches `content`.

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
              "key": { "type": "string", "description": "Key name. Knowledge keys: _known_ prefix. Empty string to delete." },
              "value": { "type": "string", "description": "The knowledge value." }
            }
          }
        }
      }
    }
  }
}
```

**Result:** `[{key, state, value}]` — the full known index.

At Phase 1 (no persistence), the result echoes back the entries the model sent, all with `state: "full"`, plus any `_tool_` keys generated during the turn with `state: "stored"`.

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

**Result:** `[{tool, target, status, key, value}]` — chronological log of all tool calls and summaries in the turn.

At Phase 1 (no persistence), the log covers the current turn only.

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
    "description": "Load a key's value into context. Key is a relative file path (src/app.js), a _known_ entry, or a _tool_ result.",
    "strict": true,
    "parameters": {
      "type": "object",
      "required": ["key", "reason"],
      "additionalProperties": false,
      "properties": {
        "key": { "type": "string", "description": "Relative file path, _known_ key, or _tool_ key." },
        "reason": { "type": "string", "description": "Why this key is needed." }
      }
    }
  }
}
```

**Result:** `pass: {key} # file retained ({N} lines) [_tool_{id}]`

### `drop` (shared)

```json
{
  "type": "function",
  "function": {
    "name": "drop",
    "description": "Demote a key from context. Key is a relative file path, _known_ entry, or _tool_ result.",
    "strict": true,
    "parameters": {
      "type": "object",
      "required": ["key", "reason"],
      "additionalProperties": false,
      "properties": {
        "key": { "type": "string", "description": "Relative file path, _known_ key, or _tool_ key." },
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

**Result:** `pass: {command} # exit 0 [_tool_{id}]` or `error: {command} # exit {code} [_tool_{id}]`

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

**Result:** `pass: {command} # exit 0 [_tool_{id}]` or `error: {command} # exit {code} [_tool_{id}]`

### `delete` (act only)

```json
{
  "type": "function",
  "function": {
    "name": "delete",
    "description": "Delete a key. Removes file from disk if key is a file path, removes entry if _known_ or _tool_ key.",
    "strict": true,
    "parameters": {
      "type": "object",
      "required": ["key", "reason"],
      "additionalProperties": false,
      "properties": {
        "key": { "type": "string", "description": "Relative file path, _known_ key, or _tool_ key." },
        "reason": { "type": "string", "description": "Why this should be deleted." }
      }
    }
  }
}
```

**Result:** `pass: {key} # deleted [_tool_{id}]`

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

**Result:** `pass: {file} # edit applied [_tool_{id}]` or `warn: {file} # edits rejected by user [_tool_{id}]`

## Tables

No new tables in Phase 1. Existing tables with modified usage or schema additions:

### `turn_elements` (modified usage)

Tool calls are stored as child elements of the assistant node. Each tool call becomes a `turn_element`. Content is dead — not stored.

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
       └─ ... (one tool_call per call in the response)
```

Tool results are stored as `pending_context` rows (see below), not as `turn_elements`. They become `role: "tool"` messages during serialization.

### `pending_context` (modified usage)

Each row maps to a `role: "tool"` message. New column `tool_call_id` links the result to its originating call:

```sql
-- Migration: add tool_call_id to pending_context
ALTER TABLE pending_context ADD COLUMN tool_call_id TEXT;
```

| Column | Old usage | New usage |
|--------|-----------|-----------|
| `type` | `command`, `env`, `diff`, `notification`, `inject` | Same values, unchanged |
| `request` | Original request text | Original request text |
| `result` | Formatted result text | Tool result content string |
| `is_error` | Boolean | Boolean |
| `source_turn_id` | Turn that produced the finding | Turn that produced the tool call |
| `tool_call_id` | *(new)* | The `tool_calls[].id` from the assistant message |

### `findings_diffs`, `findings_commands`, `findings_notifications`

Unchanged structure. The `FindingsProcessor` reads from `tool_calls` instead of parsed JSON `todo`, but the findings tables are the same. New column links each finding to its originating tool call:

```sql
-- Migration: add tool_call_id to findings tables
ALTER TABLE findings_diffs ADD COLUMN tool_call_id TEXT;
ALTER TABLE findings_commands ADD COLUMN tool_call_id TEXT;
ALTER TABLE findings_notifications ADD COLUMN tool_call_id TEXT;
```

### `v_turn_history` (view — needs update)

The current view selects `tag_name = 'content'` for assistant messages. With tool calling, the assistant message has both `content` and `tool_call` elements. The view needs to be updated to reconstruct the full assistant message from its child elements, or replaced with a query that joins tool calls and tool results into the message history format.

## Examples

### Example 1: Ask mode — first turn, model reads files

**Model response** (content is null, server reads tool_calls only):

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
        "arguments": "{\"entries\":[{\"key\":\"_known_framework\",\"value\":\"Express with passport middleware\"}]}"
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

**Server sends back (one message per tool result, in order):**

```json
{
  "role": "tool",
  "tool_call_id": "call_001",
  "content": "[{\"key\":\"_known_framework\",\"state\":\"full\",\"value\":\"Express with passport middleware\"},{\"key\":\"_tool_a3f8x\",\"state\":\"stored\",\"value\":\"\"},{\"key\":\"_tool_b7k2m\",\"state\":\"stored\",\"value\":\"\"}]"
}
```

```json
{
  "role": "tool",
  "tool_call_id": "call_002",
  "content": "pass: src/config.js # file retained (89 lines) [_tool_a3f8x]"
}
```

```json
{
  "role": "tool",
  "tool_call_id": "call_003",
  "content": "pass: src/routes/auth.js # file retained (156 lines) [_tool_b7k2m]"
}
```

```json
{
  "role": "tool",
  "tool_call_id": "call_004",
  "content": "[\"Which session store is configured\",\"Whether tokens are rotated\"]"
}
```

```json
{
  "role": "tool",
  "tool_call_id": "call_005",
  "content": "[{\"tool\":\"read\",\"target\":\"src/config.js\",\"status\":\"pass\",\"key\":\"_tool_a3f8x\",\"value\":\"\"},{\"tool\":\"read\",\"target\":\"src/routes/auth.js\",\"status\":\"pass\",\"key\":\"_tool_b7k2m\",\"value\":\"\"},{\"tool\":\"summary\",\"target\":\"\",\"status\":\"summary\",\"key\":\"\",\"value\":\"Reading config and routes to understand the auth flow.\"}]"
}
```

### Example 2: Act mode — model edits a file and runs a command

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
        "arguments": "{\"entries\":[{\"key\":\"_known_port_change\",\"value\":\"3000 -> 8080 in src/config.js\"}]}"
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

**Server executes edit (user accepts), then run, then sends results:**

```json
{ "role": "tool", "tool_call_id": "call_010", "content": "[{\"key\":\"_known_port_change\",\"state\":\"full\",\"value\":\"3000 -> 8080 in src/config.js\"},{\"key\":\"_tool_p4w9n\",\"state\":\"stored\",\"value\":\"\"},{\"key\":\"_tool_q1r6t\",\"state\":\"stored\",\"value\":\"\"}]" }
```

```json
{ "role": "tool", "tool_call_id": "call_011", "content": "pass: src/config.js # edit applied [_tool_p4w9n]" }
```

```json
{ "role": "tool", "tool_call_id": "call_012", "content": "error: npm test # exit 1 [_tool_q1r6t]" }
```

```json
{ "role": "tool", "tool_call_id": "call_013", "content": "[{\"tool\":\"edit\",\"target\":\"src/config.js\",\"status\":\"pass\",\"key\":\"_tool_p4w9n\",\"value\":\"\"},{\"tool\":\"run\",\"target\":\"npm test\",\"status\":\"error\",\"key\":\"_tool_q1r6t\",\"value\":\"\"},{\"tool\":\"summary\",\"target\":\"\",\"status\":\"summary\",\"key\":\"\",\"value\":\"Changing port to 8080 and running tests.\"}]" }
```

### Example 3: Act mode — edit rejected by user

**Model proposes an edit, user rejects it:**

```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call_020",
      "type": "function",
      "function": {
        "name": "known",
        "arguments": "{\"entries\":[{\"key\":\"_known_refactor_target\",\"value\":\"src/middleware/auth.js — sync to async\"}]}"
      }
    },
    {
      "id": "call_021",
      "type": "function",
      "function": {
        "name": "edit",
        "arguments": "{\"file\":\"src/middleware/auth.js\",\"search\":\"function verify(token) {\",\"replace\":\"async function verify(token) {\"}"
      }
    },
    {
      "id": "call_022",
      "type": "function",
      "function": {
        "name": "summary",
        "arguments": "{\"text\":\"Refactoring auth middleware to async.\"}"
      }
    }
  ]
}
```

**Server presents diff to user. User rejects. Server sends results:**

```json
{ "role": "tool", "tool_call_id": "call_020", "content": "[{\"key\":\"_known_refactor_target\",\"state\":\"full\",\"value\":\"src/middleware/auth.js — sync to async\"},{\"key\":\"_tool_j8v3c\",\"state\":\"stored\",\"value\":\"\"}]" }
```

```json
{ "role": "tool", "tool_call_id": "call_021", "content": "warn: src/middleware/auth.js # edits rejected by user [_tool_j8v3c]" }
```

```json
{ "role": "tool", "tool_call_id": "call_022", "content": "[{\"tool\":\"edit\",\"target\":\"src/middleware/auth.js\",\"status\":\"warn\",\"key\":\"_tool_j8v3c\",\"value\":\"\"},{\"tool\":\"summary\",\"target\":\"\",\"status\":\"summary\",\"key\":\"\",\"value\":\"Refactoring auth middleware to async.\"}]" }
```

The model sees `warn` on the edit and the summary log confirms the rejection. It can `read(_tool_j8v3c)` on the next turn to see the full rejection details if needed.

### Example 4: Ask mode — model has nothing unknown

**Model response (no `unknown` tool call):**

```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call_030",
      "type": "function",
      "function": {
        "name": "known",
        "arguments": "{\"entries\":[{\"key\":\"_known_db\",\"value\":\"SQLite via @possumtech/sqlrite, node:sqlite under the hood\"}]}"
      }
    },
    {
      "id": "call_031",
      "type": "function",
      "function": {
        "name": "summary",
        "arguments": "{\"text\":\"The project uses SQLite via @possumtech/sqlrite.\"}"
      }
    }
  ]
}
```

**Server sends results:**

```json
{ "role": "tool", "tool_call_id": "call_030", "content": "[{\"key\":\"_known_db\",\"state\":\"full\",\"value\":\"SQLite via @possumtech/sqlrite, node:sqlite under the hood\"}]" }
```

```json
{ "role": "tool", "tool_call_id": "call_031", "content": "[{\"tool\":\"summary\",\"target\":\"\",\"status\":\"summary\",\"key\":\"\",\"value\":\"The project uses SQLite via @possumtech/sqlrite.\"}]" }
```

No `unknown` tool call, no `unknown` result. Valid response — `unknown` is optional.

### Example 5: Multi-turn continuation (turn 2 after Example 1)

After receiving tool results from Example 1, the server calls the API again. The model now has file contents in context and continues:

**Model response (turn 2):**

```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call_040",
      "type": "function",
      "function": {
        "name": "known",
        "arguments": "{\"entries\":[{\"key\":\"_known_framework\",\"value\":\"Express with passport-local strategy\"},{\"key\":\"_known_session_store\",\"value\":\"Redis via connect-redis\"},{\"key\":\"_known_token_rotation\",\"value\":\"No rotation — tokens are static JWTs\"}]}"
      }
    },
    {
      "id": "call_041",
      "type": "function",
      "function": {
        "name": "summary",
        "arguments": "{\"text\":\"Auth uses passport-local with Redis session store.\"}"
      }
    }
  ]
}
```

**Server sends results. Known result now reflects updated entries. Summary log spans both turns:**

```json
{ "role": "tool", "tool_call_id": "call_040", "content": "[{\"key\":\"_known_framework\",\"state\":\"full\",\"value\":\"Express with passport-local strategy\"},{\"key\":\"_known_session_store\",\"state\":\"full\",\"value\":\"Redis via connect-redis\"},{\"key\":\"_known_token_rotation\",\"state\":\"full\",\"value\":\"No rotation — tokens are static JWTs\"},{\"key\":\"_tool_a3f8x\",\"state\":\"stored\",\"value\":\"\"},{\"key\":\"_tool_b7k2m\",\"state\":\"stored\",\"value\":\"\"}]" }
```

```json
{ "role": "tool", "tool_call_id": "call_041", "content": "[{\"tool\":\"read\",\"target\":\"src/config.js\",\"status\":\"pass\",\"key\":\"_tool_a3f8x\",\"value\":\"\"},{\"tool\":\"read\",\"target\":\"src/routes/auth.js\",\"status\":\"pass\",\"key\":\"_tool_b7k2m\",\"value\":\"\"},{\"tool\":\"summary\",\"target\":\"\",\"status\":\"summary\",\"key\":\"\",\"value\":\"Reading config and routes to understand the auth flow.\"},{\"tool\":\"summary\",\"target\":\"\",\"status\":\"summary\",\"key\":\"\",\"value\":\"Auth uses passport-local with Redis session store.\"}]" }
```

Note: at Phase 1 (no persistence), the server tracks known entries and the log in-memory for the duration of the run. The known result reflects all entries emitted so far. The summary log reflects all tool calls and summaries across all turns in the run.

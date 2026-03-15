# SNORE: Sqlite/Node OpenRouter Engine

SNORE is a system-wide service that orchestrates agent sessions for multiple clients (e.g., nvim instances). It uses SQLite as the single source of truth, storing all state, history, and project maps in relational tables.

## Architecture

- **Project:** Persistent, shared folder foundation.
- **Session:** Unique client connection.
- **Job:** Execution unit (Ask/Act).
- **Turn:** Request/Response LLM round.

## Plugin Architecture (Hooks & Filters)

SNORE is built on a "Lean Core" philosophy. Almost all behavior is implemented as modular plugins using a WordPress-style Hook/Filter system.

### Hook Map

#### 1. Core Actions (Events)
- `project_initialized ({ projectId, projectPath, db })`
- `files_updated ({ projectId, projectPath, files, db })`
- `job_started ({ jobId, sessionId, type })`
- `ask_completed ({ jobId, sessionId, response })`

#### 2. Core Filters (Mutators)
- `rpc_request (message)`
- `rpc_response_result (result, { method, id })`
- `job_config (config, { sessionId })`
- `llm_messages (messages, { model, sessionId })`
- `llm_response (message, { model, sessionId, jobId })`

#### 3. Turn Slots (XML Pipeline)
| Slot | Target Section |
| :--- | :--- |
| `TURN_SYSTEM_PROMPT` | Core instructions for the agent. |
| `TURN_CONTEXT_FILES` | Injects `<files>` tags (Hot/Cold/Full). |
| `TURN_CONTEXT_GIT_CHANGES` | Injects `<git_changes>` tags. |
| `TURN_CONTEXT_ERROR` | Injects `<error>` squiggles. |
| `TURN_USER_PROMPT` | The actual user request inside `<ask>`. |

### Creating a Plugin
Create `src/plugins/MyPlugin.js`:
```javascript
export default class MyPlugin {
    static register(hooks) {
        hooks.addAction("TURN_SYSTEM_PROMPT", async (slot) => {
            slot.add("You are an expert coder.", 1);
        });
    }
}
```
Plugins ending in `Plugin.js` are automatically loaded at boot.

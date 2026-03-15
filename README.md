# SNORE: Sqlite/Node OpenRouter Engine

SNORE is a high-integrity, system-wide agent service that orchestrates LLM sessions for multiple clients (e.g., Neovim instances). It treats the project codebase as a **Relational Single Source of Truth**, storing state, history, and semantic maps in a shared SQLite database.

## Key Features

- **Lean Core:** A modular, plugin-first architecture using WordPress-style hooks and filters.
- **Dynamic Context:** Automated repository mapping with a "Hot/Cold" lens to optimize token usage.
- **Relational Integrity:** Strictly enforced database constraints and flattened token metrics.
- **System-Wide:** One service manages multiple projects and sessions, defaulting to `~/.snore`.
- **Audit-First:** Prettified XML turn audits for every model exchange.

## Installation

```bash
git clone https://github.com/possumtech/snore
cd snore/main
npm install
cp .env.example .env
# Add your OPENROUTER_API_KEY to .env
```

## Usage

### Start the Service
```bash
npm start   # Production mode
npm run dev # Watch mode with dev database
npm run debug # Debug mode on port 3047 with verbose telemetry
```

### Manual Testing
You can run the live "Paris" test to verify your installation:
```bash
node test/example_paris.js
```

## Plugin Architecture

SNORE is infinitely extensible. Create a JavaScript file in `src/internal/` (for core logic) or `~/.snore/plugins/` (for user customizations).

### Creating a Plugin
```javascript
export default class MyPlugin {
    static register(hooks) {
        hooks.addAction("TURN_SYSTEM_PROMPT", async (slot) => {
            slot.add("You are an expert pair programmer.", 1);
        });
    }
}
```

### Hook Map

| Type | Name | Purpose |
| :--- | :--- | :--- |
| **Action** | `project_initialized` | Runs after a project is opened. |
| **Action** | `ask_completed` | Runs after a model response is received. |
| **Filter** | `rpc_request` | Intercept and modify JSON-RPC calls. |
| **Slot** | `TURN_SYSTEM_PROMPT` | Inject instructions into the system prompt. |
| **Slot** | `TURN_CONTEXT_FILES` | Add file content or symbols to context. |

See `AGENTS.md` for the full architectural specification and XML pipeline details.

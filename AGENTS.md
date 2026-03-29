# AGENTS: Planning & Progress

## Active: Tool Calling Migration

Replacing `response_format` JSON schema with native tool calling. The known K/V
store, summary log, and unknown list ARE the model's context. No message history.
File management system fully cannibalized into the K/V store.

### Completed

- [x] Migration schema — `known_entries` table with normalized `domain`/`state`, state lock trigger, unresolved view
- [x] SQL queries — upsert, get, delete, resolve, run log, next result key
- [x] Tool definition JSONs — `tools.ask.json` (7 tools), `tools.act.json` (10 tools)
- [x] `KnownStore.js` — unified state manager (upsert, resolve, model projection, log, namespace routing)
- [x] `ContextAssembler.js` — system prompt + user message (no synthetic history)
- [x] `OpenRouterClient.js` — tools + tool_choice + empty-object shim, Ollama argument normalization
- [x] `ToolExtractor.js` — reads tool_calls array, separates action/structural calls
- [x] `TurnExecutor.js` — new execution flow (context assembly → LLM → tool extraction → known store)
- [x] `AgentLoop.js` — resolve/inject operate on known store, no findings tables
- [x] Legacy tests archived to `test_old/`
- [x] Doc alignment — ARCHITECTURE.md rewritten, consolidated to 3 docs

### Remaining

- [ ] `StateEvaluator.js` — simplify (checks known store for proposed entries)
- [ ] System prompts — `system.ask.md`, `system.act.md` rewrite
- [ ] File bootstrap — populate known_entries from repo map at run start
- [ ] Plugin updates — `mapping.js` (stop injecting docs), `context.js` (dead), `tools.js` (tool definitions)
- [ ] Delete dead code — old schema files, FindingsProcessor, FindingsManager, old SQL queries
- [ ] Wire up `KnownStore` in dependency injection (wherever AgentLoop/TurnExecutor are constructed)
- [ ] New tests for KnownStore, ContextAssembler, ToolExtractor, TurnExecutor
- [ ] E2E test against real model
- [ ] RPC updates — `run/resolve` uses `key` instead of `{category, id}`
- [ ] Notification payload updates — `key` instead of `findingId`
- [ ] Client promotion migration — `activate`/`readOnly`/`ignore` write to known store

### Dead Code (to delete after migration)

- `src/domain/schema/ask.json`, `act.json`
- `src/application/agent/FindingsProcessor.js`
- `src/application/agent/FindingsManager.js`
- `src/application/agent/insert_finding_diff.sql`, `insert_finding_command.sql`, `insert_finding_notification.sql`
- `src/application/agent/update_finding_*_status.sql`
- `src/application/agent/get_findings_by_run_id.sql`, `get_unresolved_findings.sql`
- `src/application/agent/insert_pending_context.sql`, `get_pending_context.sql`, `consume_pending_context.sql`
- `src/application/agent/get_turn_history.sql`
- `src/application/plugins/context/context.js` (feedback injection — dead)
- `src/application/session/purge_consumed_context.sql`

---

## Future: Project Condi

With the K/V store proven, the door opens for:

- **Knowledge graph extraction** — the `/:` sentinel is a scannable anchor. When
  the model writes `/:known/auth_flow` inside another key's value, that's a
  citation edge. Scan values for `/:` references to build a dependency graph.
  Graph topology becomes the eviction policy.
- **Context budgeting** — dynamically demote entries from `full`/`file` to
  `symbols`/`stored` based on token budget. The model uses `read` to promote
  on demand.
- **Simulation harness** — replay recorded runs to test caching/eviction offline.
- **Janitorial turns** — dedicated turns where the model consolidates or prunes
  its own key space.
- **Cross-run knowledge** — gated and careful. Currently run-scoped by design.

---

## Historical

### Provider Hardening (2026-03-29)
- OpenAI-compatible provider, GBNF grammar, reasoning normalization
- getContextSize fails hard, run status `failed`, healing layer
- Provider model catalog with 24h cache

### Quality & Docs (2026-03-28)
- Coverage 90/79/87, doc-driven integration tests, 12 e2e tests
- ARCHITECTURE.md + PLUGINS.md alignment

### Run Naming + Model Enforcement (2026-03-28)
- Model alias enforcement, run aliases, RPC contract

### XML Elimination (2026-03-28)
- @xmldom/xmldom removed, plain objects, Markdown rendering

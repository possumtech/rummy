# PLAN

## Remaining

(empty — feature freeze reached)

## Done

### Pluginification Refactor (2026-03-27)
- [x] **ToolRegistry** — `hooks.tools.register()` replaces hardcoded ACT_TOOLS. ToolExtractor queries the registry.
- [x] **RpcRegistry** — `hooks.rpc.registry.register()` replaces 300-line switch. `discover` auto-generates.
- [x] **AgentLoop decomposition** — TurnExecutor, FindingsProcessor, StateEvaluator extracted. AgentLoop is orchestrator only.
- [x] **CoreToolsPlugin** — 9 core tools registered via `hooks.tools.register()`.
- [x] **CoreRpcPlugin** — 20 RPC methods registered via `hooks.rpc.registry.register()`.
- [x] **Hookable state table** — `hooks.agent.warn` and `hooks.agent.action` filters let plugins modify rules.
- [x] **PLUGINS.md** — Plugin author contract documented.

### Earlier Work (2026-03-27)
- [x] Cross-reference population, heat wiring, fidelity decay fix
- [x] Structured feedback delivery, concrete nag templates, stray output detection
- [x] Empty SEARCH append fix, rejection flow (no auto-resume)
- [x] Doc/impl alignment, retention policies, client promo ranking integration
- [x] E2E test hardening (prefill workflow, notification isolation, discover contract)

## Next

The system is at feature freeze. The plugin contract (`PLUGINS.md`) is documented.
Next stage: third-party plugin development and real-world testing.

# PLAN

## Remaining

All items complete. Awaiting e2e test results against live model.

## Done

### Quality & Docs (2026-03-28)
- [x] **80/80/80 coverage** — 90% lines / 81% branches / 89% functions
- [x] **Doc-driven integration tests** — 9 files, slug convention `{section}_{topic}.test.js`, 47 tests defending §1-§8
- [x] **12 e2e tests** — foundation, diff content/resolution, editor/diff lifecycle, command resolution, run lifecycle/modes, fidelity decay, notification isolation, reasoning, RPC surface, protocol alignment
- [x] **ARCHITECTURE.md** — JSON structured output, run aliases, model enforcement, new RPCs, cumulative usage, Markdown context, corrected tool categorization, removed client prefix semantics
- [x] **PLUGINS.md** — plain-object node API, `.children.push()`, `run` in events

### Client to Server (2026-03-28)
- [x] **Cumulative usage** — `run/step/completed` includes `cumulative: { prompt_tokens, completion_tokens, total_tokens, cost }`
- [x] **Temperature state** — `setTemperature` / `getTemperature` RPCs, session-stored, clamped 0-2
- [x] **Skill query** — `getSkills` RPC returns `string[]`
- [x] **normalize()** — won't fix server-side, client concern

### Run Naming + Model Enforcement (2026-03-28)
- [x] **Model alias enforcement** — `LlmProvider.resolve()` requires defined alias
- [x] **Run aliases** — `alias TEXT NOT NULL UNIQUE`, auto-generated `{model}_{N}`
- [x] **RPC contract** — `runId` → `run` everywhere, notifications use alias
- [x] **New RPCs** — `getRuns`, `run/rename`, `run/inject`, `getSkills`, `setTemperature`, `getTemperature`
- [x] **FileChangePlugin** — VCS-agnostic rename from GitPlugin

### XML Elimination (2026-03-28)
- [x] **@xmldom/xmldom removed** — plain objects, Markdown rendering
- [x] **TurnBuilder, RummyContext, Turn, all plugins** updated

### Bug Fixes (2026-03-28)
- [x] **Act file creation hang** — ToolExtractor routes `search: ""` to create
- [x] **Timeout wiring** — `RUMMY_FETCH_TIMEOUT` + `RUMMY_RPC_TIMEOUT`
- [x] **Dead code sweep** — allForMode, unused vars, unreachable blocks

# PLAN

## Remaining

Nothing pending. Stabilizing for next phase.

## Done

### Provider Hardening (2026-03-28)
- [x] **OpenAI-compatible provider** — `openai/` prefix, OpenAiClient with GBNF grammar enforcement
- [x] **GBNF grammar generator** — `gbnf.js` converts JSON schema to GBNF with required `<think>` preamble. Token-level enforcement + thinking preserved.
- [x] **reasoning_content normalization** — all three providers (OpenRouter, Ollama, OpenAI-compat) normalize to `reasoning_content`
- [x] **getContextSize fails hard** — no silent nulls. OpenRouter, Ollama, OpenAI-compat all throw on failure.
- [x] **Run status `failed`** — uncaught errors in turn loop mark run as failed, not stuck at queued
- [x] **Removed `hasSummary`** — stale rule caused 3 wasted retry turns. Summary is always present (schema-required).
- [x] **Removed ajv** — contract enforced by providers (response_format, format, GBNF grammar). No validation layers.
- [x] **Removed `|| []` fallbacks** — trust the contract. `parsed.todo` is an array or it crashes.
- [x] **Schema descriptions carry behavior** — "only read files that exist in project", "never edit before reading". System prompt is one line.
- [x] **mmap_size 256GB** — memory-mapped reads for DB performance

### Quality & Docs (2026-03-28)
- [x] **80/80/80 coverage** — 90% lines / 81% branches / 89% functions
- [x] **Doc-driven integration tests** — 9 files, slug convention `{section}_{topic}.test.js`, 47 tests defending §1-§8
- [x] **12 e2e tests** — all migrated to `run` API, zero `runId` references
- [x] **ARCHITECTURE.md** — JSON structured output, run aliases, model enforcement, new RPCs, cumulative usage, Markdown context
- [x] **PLUGINS.md** — plain-object node API, `run` in events

### Client to Server (2026-03-28)
- [x] **Cumulative usage** — `run/step/completed` includes `cumulative`
- [x] **Temperature state** — `setTemperature` / `getTemperature` RPCs
- [x] **Skill query** — `getSkills` RPC
- [x] **normalize()** — won't fix server-side

### Run Naming + Model Enforcement (2026-03-28)
- [x] **Model alias enforcement** — `LlmProvider.resolve()` requires defined alias
- [x] **Run aliases** — `alias TEXT NOT NULL UNIQUE`, auto-generated `{model}_{N}`
- [x] **RPC contract** — `runId` → `run` everywhere
- [x] **New RPCs** — `getRuns`, `run/rename`, `run/inject`, `getSkills`, `setTemperature`, `getTemperature`
- [x] **FileChangePlugin** — VCS-agnostic

### XML Elimination (2026-03-28)
- [x] **@xmldom/xmldom removed** — plain objects, Markdown rendering, all plugins updated

### Bug Fixes (2026-03-28)
- [x] **Act file creation hang** — ToolExtractor routes `search: ""` to create
- [x] **Timeout wiring** — `RUMMY_FETCH_TIMEOUT` + `RUMMY_RPC_TIMEOUT`
- [x] **Dead code sweep** — allForMode, unused vars, unreachable blocks

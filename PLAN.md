# PLAN

## Remaining

### Tool Calling Migration

Replace self-formatted JSON with native tool calling protocol. The model writes
natural text (with known/unknown as structured JSON in content) and calls tools
explicitly when it needs to act.

**Tools (function calls):**
- `read(path)` — retain file in context
- `drop(path)` — remove file from context
- `env(command)` — read-only shell command
- `run(command)` — mutating shell command
- `delete(path)` — delete file
- `edit(file, search, replace)` — modify existing file
- `create(file, content)` — create new file
- `summary(text)` — deliver answer/status to user
- `prompt(question, options[])` — ask user a question

**Content (model's natural response):**
- `known` — facts, analysis, plans (structured JSON in content)
- `unknown` — what remains to find out (structured JSON in content)
- Free-form reasoning visible to the user

**Why this fixes flakiness:**
- Model doesn't choose between "summarize" and "edit" — it calls the edit tool
- Tool schemas are enforced by the provider at the API level
- No healing, no fallbacks, no "put it in the edits array" prompting
- Same protocol across OpenRouter, Ollama, and llama-server

**Migration scope:**
- [ ] Define tool schemas (OpenAI function calling format)
- [ ] Update LLM clients to send `tools` parameter
- [ ] New response parser: extract `tool_calls` + content
- [ ] Map tool calls to existing FindingsManager pipeline
- [ ] Update system prompts (simpler — no JSON format instructions)
- [ ] Update GBNF grammar for llama-server tool calling template
- [ ] Update e2e tests — assertions on tool calls, not JSON structure
- [ ] Update ARCHITECTURE.md and PLUGINS.md

## Done

### Provider Hardening (2026-03-29)
- [x] **OpenAI-compatible provider** — `openai/` prefix, GBNF grammar enforcement
- [x] **GBNF grammar generator** — required `<think>` preamble, token-level enforcement
- [x] **reasoning_content normalization** — all providers: `reasoning`, `thinking`, `reasoning_details` merged
- [x] **getContextSize fails hard** — no silent nulls, all providers
- [x] **Run status `failed`** — uncaught errors mark run failed
- [x] **Removed `hasSummary`** — stale rule causing wasted retries
- [x] **Schema in system prompt** — always injected, all providers
- [x] **Healing layer** — missing todo/known/unknown/summary healed with warning
- [x] **Control character sanitization** — bare control chars escaped before JSON.parse
- [x] **Provider model catalog** — `provider_models` table, 24h cache, startup prefetch
- [x] **Startup alias validation** — warns about missing strict schema or reasoning
- [x] **mmap_size 256GB** — memory-mapped reads

### Quality & Docs (2026-03-28)
- [x] **Coverage 90/79/87** — unit + integration
- [x] **Doc-driven integration tests** — 9 files, 55 tests defending §1-§8
- [x] **12 e2e tests** — migrated to `run` API, spec reporter
- [x] **Test split** — `npm test` (fast), `npm run test:e2e` (live model)
- [x] **ARCHITECTURE.md + PLUGINS.md** — fully aligned with implementation

### Client to Server (2026-03-28)
- [x] **Cumulative usage, temperature, getSkills, normalize()** — all resolved

### Run Naming + Model Enforcement (2026-03-28)
- [x] **Model alias enforcement, run aliases, RPC contract, new RPCs, FileChangePlugin**

### XML Elimination (2026-03-28)
- [x] **@xmldom/xmldom removed** — plain objects, Markdown rendering

### Bug Fixes (2026-03-28)
- [x] **Act file creation hang, timeout wiring, dead code sweep**

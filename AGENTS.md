# AGENTS: Planning & Progress

> "Is there a rummy way to do this?" Every `<tag>` the model sees is a
> plugin. Every scheme is registered by its owner. Every piece of data
> exists as an entry or a column. No exceptions without documentation.

> **"Model behavior" is never an acceptable explanation for a test failure.**
> When a model misbehaves, the system failed — suboptimal context, poorly
> designed test conditions, insufficient reinforcement of correct behavior.
> Every failure is a system bug until proven otherwise. Investigate the
> context the model saw, the instructions it was given, and the constraints
> it was operating under. If you can't explain exactly why the model did
> what it did, you haven't finished debugging.

## Current State

Plugin-driven architecture. Instantiated classes, constructor receives
`core` (PluginContext). Registration via `core.on()` / `core.filter()`.
Assembly via `assembly.system` / `assembly.user` filter chains.
No monolithic assembler. Loops table (projects > runs > loops > turns).
HTTP status codes throughout (entries, runs, loops, client RPC).
9 model tools (store removed — fidelity control via set attributes).
Budget cascade (BudgetCascade.js) with halving spiral through 3 tiers.
Crunch plugin for mid-cascade summarization. Token estimation via
tiktoken * 2x multiplier. Glob matching via picomatch.
`noInteraction` and `noWeb` flags for benchmark/headless usage.
`summary="..."` attribute on entries for model-authored descriptions.
`<knowns>` tags use entry scheme names (`<file>`, `<known>`, `<https>`).
173 unit + 112 integration passing. 12/14 e2e (file edit assertions).
MAB and LME benchmark runners built. Live tests need rerun.

### Architecture Notes

**Budget is a plugin.** `src/plugins/budget/budget.js` registers
`hooks.budget.enforce()`. TurnExecutor delegates through the hook.
Crunch plugin subscribes to `cascade.summarize` for mid-cascade
summarization.

**toolDocs filter uses docsMap pattern.** Each plugin writes to a
keyed object (`docsMap.set = docs`). Instructions plugin filters by
`activeTools` set — enables selective inclusion for noInteraction/noWeb.

## Budget Cascade — Context Guarantee

The budget engine guarantees materialized context fits the model's
context window. Context overflow is structurally impossible.

### Selection: Fattest Half of Oldest Half

No scheme-based priority tiers. Selection is purely mechanical:
1. Sort all candidates by `source_turn` ASC (oldest first)
2. Take the oldest half
3. Within that half, sort by `tokens` DESC (fattest first)
4. Take the fattest half

This selects 25% of entries per pass — the simultaneously oldest AND
largest entries. Maximum staleness, maximum token savings per demotion.

### Crunch Spiral

The crunch spiral handles graceful degradation:
- **Full entries** → set to summary fidelity. Crunch LLM generates
  ≤80-char keyword summary stored in `attributes.summary`.
- **Summary entries with summaries > 80 chars** → summary text halved
  deterministically (no LLM call). 2000→1000→500→250→125→80.
- **Summary entries with summaries < 10 chars** → drop to index fidelity.
- Repeat until under budget or no crunchable entries remain.

The LLM crunch call fires once per entry (full→summary). Every
subsequent compression is deterministic string truncation.

ToolRegistry.view() prepends `attributes.summary` above whatever the
plugin's summary view produces. This happens automatically for all
schemes including third-party plugins.

### Death Spiral

When the crunch spiral can't free enough, the death spiral stashes
the oldest half by scheme into `known://stash_<scheme>` index entries:
- Stash entries at index fidelity — model sees path only.
- Stash body contains the full URI list of stored entries.
- Model can `<get path="known://stash_known"/>` to see the list.
- Repeat until under budget or nothing left to stash.

### Crash

If stash entries + system prompt + tool docs don't fit, that's a
configuration error — the model's context window is too small.

### 413 Budget Gate

Before the cascade runs, entry recording checks remaining budget headroom.
Any entry whose body would exceed remaining context budget is rejected with
HTTP 413. The model sees the rejection and can adapt with `<set stored/>`
or `<rm>`.

### Token Accounting

Single source of truth: `countTokens()` on the final assembled message
strings. No estimates, no per-entry overhead calculations, no disconnect
between what's measured and what's sent. The assembled message IS the
measurement.

Entry-level `tokens` column in `known_entries` and `turn_context` used
only for demotion candidate estimation (which entries to batch-demote).
Never used as the authority on whether the budget is met.

---

## Todo: Proposal Lifecycle — Remaining Work

Sequential dispatch implemented: commands execute one at a time.
On 202 (proposed) or >= 400 (error), remaining commands abort with
409 and context message. Get handler returns 413 when files would
exceed context budget.

Remaining:
- [ ] Integration test for sequential abort behavior
- [ ] E2E test: model sends rm + summarize, rm rejected, verify
  model sees rejection + aborted summarize on next turn

## Todo: Repetition Detection — Get Handler Dedup

When the model sends `<get path="lua/*.lua">` AND individual
`<get>lua/init.lua</get>` in the same response, files promote
twice. The overhead is minimal (promotion is idempotent) but
receipt entries accumulate. Low priority.





## Todo: Test Improvements

- [x] E2E test diagnostic DBs persist to /tmp/rummy_test_diag/
- [x] Integration test for scheme registration via plugins (8 tests)
- [x] Ask mode restrictions (already covered in mode_enforcement.test.js)
- [x] Sed chaining (already covered in XmlParser.test.js)
- [ ] Fix set handler integration tests (path normalization mismatch
  between test setup `set://src%2F...` and handler's `set://src/...`)
- [ ] Live tests need rerun for HTTP status code migration

## Done: Session 2026-04-06/07 (continued)

- **`<store>` tool removed**: Fidelity control via `<set>` attributes:
  `stored`, `summary`, `index`, `full`. Direct-to-storage writes:
  `<set path="..." stored>content</set>`. 10 tools → 9.
- **`summary="..."` attribute**: Model-authored descriptions (<= 80 chars)
  persist across fidelity changes. Rendered as header in all views:
  `# <set summary="..."/>`. Falls back in ToolRegistry when no summary
  view is registered. The model describes files as it reads them —
  no janitorial pass needed.
- **Tool tags in previous/current**: Results render as `<set path="...">`
  not `<tool path="set://...">`. The history teaches the invocation syntax.
- **Native tool call normalization**: Qwen, OpenAI, Anthropic, Mistral
  formats silently translated to rummy XML in XmlParser.
- **Skill plugin**: Class renamed `Skill`, turn 0 for init-time writes.
  Persona extracted to own plugin (`persona/persona.js`).
- **XmlParser → Hedberg**: JSON edit parsing moved to `hedberg/normalize.js`.
- **Repetition detection**: Update text fingerprinting (same 3 turns =
  force-complete). Known entry dedup (80-char prefix match reuses path).
- **File scheme documented**: NULL scheme exception explained in file.js.
- **Scheme registration**: All tool plugins register. Audit schemes bootstrapped.
- **URI length cap**: 2048 chars max on known_entries.path.

## Done: Session 2026-04-06/07

- **Loops table**: projects > runs > loops > turns. Replaced prompt_queue.
  Summary/rejection checks scoped to current loop.
- **HTTP status codes**: `state TEXT` → `status INTEGER` + `fidelity TEXT`.
  Runs, loops, entries, client RPC — all integer codes. Schemes table
  simplified (no valid_states, no fidelity column). External plugins
  and rummy.nvim client migrated.
- **Budget enforcement**: Post-assembly token check demotes oldest full
  entries to summary. Token estimation via tiktoken * 2x multiplier.
  Progress section warns model. `<known ... demoted>` flag per-turn.
  Runtime context from llama.cpp `/props` endpoint.
- **Glob matching**: picomatch replaces hand-rolled globToRegex. Proper
  `**` recursive matching. Single `*` respects directory boundaries.
- **XmlParser recovery**: Known tool opening while another is current
  closes the old one. Mismatched close tags don't swallow commands.
- **Plugin loader**: Global package resolution for RUMMY_PLUGIN_* env
  vars. Local then global — no fallback, explicit error.
- **Phantom tool cleanup**: `ensureTool` only from `on("handler")`.
  File plugin no longer appears in model tool list.
- **Error feedback**: Get, set, rm return labeled errors on missing
  path (400). Rm returns 404 on no match. Path normalization for
  unencoded URIs.
- **Tool docs distributed**: Advanced patterns section removed from
  hedberg. Each tool's docs show globs, preview, body filters inline.
- **Known docs**: "entries are your memory — you forget everything else"
- **Unknowns show paths**: `<unknown path="...">` so model can rm by URI.
- **Env docs**: "Do not use env to read or list files — use get path=* preview"
- **Previous loop context**: Prompts from previous loops shown in
  `<previous>`. Assembly uses entry's own fidelity, not hardcoded.
- **File.activate promotion**: Immediately promotes matching entries,
  symmetric with File.ignore demote.
- **getEntries fidelity**: Server response includes fidelity field.
  Client uses fidelity for buffer visibility marking.
- **Set docs**: "literal SEARCH/REPLACE blocks", better error messages.
- **Rm docs**: `known://donald-rumsfeld-was-born-in-1932` example.
- **Env handler**: 202 (proposed) instead of 200 (immediate).
- **Context tokens telemetry**: Per-turn context_tokens in run/state
  for accurate statusline display.
- **rummy.nvim audit**: Status codes migrated, getEntries fidelity
  mapping, uppercase in run/rename, turn_tokens for statusline.

## Done: Earlier Sessions

- Plugin architecture refactor (18 plugins, constructor(core) pattern)
- xAI integration (Responses API)
- Hedberg plugin (patterns, matcher, sed, edits, normalize)
- Packet restructuring (system/user split, assembly filters)
- Cleanup (removed defaults, fallbacks, legacy code)

## Deferred

- Relevance engine (stochastic, separate project/plugin)
- Hedberg extraction to `@possumtech/rummy.hedberg` npm package
- Janitor plugin (deterministic context budget management)
- Bulk operation aggregation (one entry per pattern operation)
- Non-git file scanner fallback
- Separate state from fidelity (already done via HTTP codes — the
  original concern about conflation is resolved. Fidelity is its own
  column, status is HTTP codes, schemes don't constrain fidelity.)

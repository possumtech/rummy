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
13 model tools: get, set, known, unknown, env, sh, rm, cp, mv,
search, summarize, update, ask_user. Tool priority ordering (get first,
ask_user last). Unified tool exclusion via `resolveForLoop(mode, flags)`.
Budget: BudgetGuard at KnownStore layer gates every write during
dispatch. Pre-LLM check on assembled tokens. contextSize is the
ceiling, no margins. Token math: `ceil(text.length / RUMMY_TOKEN_DIVISOR)`.
No tiktoken. Panic mode: new prompt exceeds 90% of ceiling → model gets
restricted loop to free space to 50%, 3 strikes without reduction → hard 413.
500-token size gate on known entries. Glob matching via picomatch.
Tool docs in annotated `*Doc.js` line arrays with rationales.
Lifecycle/action split in TurnExecutor — summarize/update/known/unknown
always dispatch, never 409'd. Both sent → update wins. Summarize
overridden when actions fail or when read actions (get/env/search) issued
in same turn (model cannot conclude before seeing results). `<think>` /
`<thought>` tags for model reasoning — inner tool calls captured as
rawBody, never dispatched.
Preamble: XML format, conclude every turn, summaries approximate.
Four entry roles: data (knowns), logging (current/previous), unknown,
prompt. Default category: logging. `<prompt mode="ask|act">`.
Each plugin owns its own views.
PLUGINS.md: third-party developer guide, §0-§11. plugin_spec.test.js:
30 compliance tests. Hooks: tool.before/after, entry.recording filter,
turn.completed, loop.started/completed, run.created, context.materialized.
Concurrent loop protection: AbortController created at top of
`#drainQueue` before first await — closes the race on `#activeRuns`.
`normalizePath` lowercases scheme component. `<previous>` sorted
chronologically by source_turn (prompt before logging within same turn).
`progress://` scheme removed; `<progress turn="N">` is structural only.
`context_tokens` back-filled from LLM `prompt_tokens` post-response.
154 unit tests passing.

## Future Work

### Benchmarking (MAB + LME)
- Re-run after SDI fixes to measure improvement

### Smart Housekeeping (Step 3)
- Model makes informed decisions about what to demote before hitting 90%
- Step 3 of ENFORCED → FUNCTIONAL → SMART

## Deferred

- Relevance engine (stochastic, separate project/plugin)
- Hedberg extraction to `@possumtech/rummy.hedberg` npm package
- Bulk operation aggregation (one entry per pattern operation)
- Non-git file scanner fallback

---

## Done: Session 2026-04-10/11 — Packet SDI Audit + E2E

40-item SDI audit. 36 fixed, 4 no-change. Summarize/read enforcement.
14/14 E2E passing. 154 unit tests passing.

## Done: Session 2026-04-09/10 — Budget Enforcement + Paradigm Shift

## Done: Session 2026-04-09 — Paradigm Audit

## Done: Session 2026-04-06/07

## Done: Earlier Sessions

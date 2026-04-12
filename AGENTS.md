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
Budget: ceiling = `floor(contextSize × 0.9)`. The 10% headroom is the
system's operating room for graceful overflow handling.
  - **Prompt Demotion**: new prompt exceeds ceiling → summarize the prompt,
    model runs in the headroom and manages its own context.
  - **Turn Demotion**: post-dispatch context exceeds ceiling → demote all
    entries from this turn to summary (all schemes except budget), write
    `budget://` entry listing what was demoted. Model sees it next turn
    and adapts. No per-write gating — tools run uninterrupted, demotion
    happens after.
  - **LLM rejection**: turn-1 token estimate drift causes LLM to reject
    what the budget check approved → `isContextExceeded` catch, same
    demotion pattern, uses the 10% headroom for recovery.
  - **Previous-loop entries**: model-managed. Preamble instructs model to
    demote `<previous>` entries to summary with descriptive tags.
Token math: `ceil(text.length / RUMMY_TOKEN_DIVISOR)`. No tiktoken.
500-token size gate on known entries. Glob matching via picomatch.
Tool docs in annotated `*Doc.js` line arrays with rationales.
Lifecycle/action split in TurnExecutor — summarize/update/known/unknown
always dispatch, never 409'd. Both sent → update wins. Summarize
overridden only when actions fail (4xx/5xx). `<think>` / `<thought>` tags
for model reasoning — inner tool calls captured as rawBody, never dispatched.
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
Budget enforcement uses actual `prompt_tokens` from last API response when
available — falls back to `ceil(chars / RUMMY_TOKEN_DIVISOR)` on turn 1.
Audit entries (assistant://, system://, user://, model://, reasoning://,
content://) written at `fidelity: "archive"` — excluded from model context
by both model_visible=0 scheme registration and explicit archive filter.

## Benchmark Plan

### What we're measuring

Rummy's memory management under pressure. The claim: a small local model
running inside Rummy's context system can answer questions about documents
too large to fit in its context window — because panic mode compresses and
retrieves rather than failing. The benchmarks test whether that claim holds.

Hardware: local llama server, Gemma 4 26B Q3, 32K context, ~45s/chunk.
Token divisor: 2 (approximate). Results are system + model combined.

---

### Status

**Bug fixes applied (2026-04-12)**:
- `budget.enforce` now uses actual `prompt_tokens` from last API response
  instead of the `ceil(chars/2)` estimate. The estimate was 7x off for
  structured/XML-heavy content, causing false 413s on the gemma run.
- Audit entries written at `fidelity: "archive"` — belt-and-suspenders
  alongside the existing model_visible=0 exclusion.
- `RUMMY_CONTEXT_LIMIT` / `--context-limit` supported in both MAB and LME
  runners. `test:grok` script loads `.env.grok` for xAI credentials.

**Next run**: re-run MAB with gemma now that false-413 root cause is fixed:
```
npm run test:mab -- --split Conflict_Resolution
```

**Parallel validation**: run grok against Conflict_Resolution with capped
context to confirm context management works at speed:
```
npm run test:grok -- --split Conflict_Resolution
```

### Published Baselines (MemoryAgentBench, ICLR 2026)

Source: HUST-AI-HYZ/MemoryAgentBench — arXiv 2507.05257

| Model | CR-SH (single-hop) | CR-MH (multi-hop) |
|---|---|---|
| GPT-4o | 60% | **5%** |
| Claude 3.7 Sonnet | 43% | 2% |
| Gemini 2.0 Flash | 30% | 3% |
| Best published | 60% | **6%** |

CR-MH (Conflict_Resolution multi-hop) is what the `test:mab` CR split runs.
**The ceiling is ~5–6%.** Any score is meaningful noise at this difficulty.
What we're actually measuring: does the model file, retrieve, and reason
correctly — not the absolute score.

Taxonomy health check (fast, no questions):
```
npm run test:grok:taxonomy
npm run test:mab:taxonomy
```

---

### MAB (MemoryAgentBench)

Four splits. Only two are tractable on this hardware for a credible run.

**Phase 1 — Conflict_Resolution (run overnight)**
```
npm run test:mab -- --split Conflict_Resolution
```
- 8 rows, ~782 chunks, 800 questions, ~10h
- Full split — every row, publishable
- Tests contradiction detection and resolution: the hardest retrieval task
- If panic fires, we see whether the model compresses intelligently or stalls

**Phase 2 — Accurate_Retrieval subset (run alongside or after)**
```
npm run test:mab -- --split Accurate_Retrieval --row 0-4
```
- 5 of 22 rows, ~1535 chunks, ~450 questions, ~19h
- Not a full split but row 0 alone (985K chars, 100 questions) is a meaningful
  standalone stress test — largest context in the dataset
- Tests baseline fact retrieval: did the model save the right things?

**Skip — Long_Range_Understanding**: 110 rows, ~250h. Not tractable.

**Skip — Test_Time_Learning**: interesting (knowledge updates over time) but
6 rows averaging 317 chunks each = ~24h. Run after CR and AR.

**Minimum credible MAB result**: Phase 1 only (CR full) + AR row 0.
CR full gives 800 questions across 8 rows. AR row 0 gives 100 questions
on the largest document in the dataset. Together: ~16h, ~900 questions.

---

### LME (LongMemEval)

Two splits. Oracle is structured differently (pre-extracted facts, likely
much faster). Check before committing.

```
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const rows = readFileSync('test/lme/data/longmemeval_oracle.ndjson','utf8')
  .trim().split('\n').map(l=>JSON.parse(l));
console.log(Object.keys(rows[0]));
console.log(JSON.stringify(rows[0]).length, 'chars row 0');
"
```

If oracle rows are small (<20K chars each): run 50-100 rows overnight.
If similar size to `_s_cleaned`: run rows 0-19 as a diagnostic sample.

```
npm run test:lme -- --split longmemeval_oracle --row 0-49
```

LME tests temporal reasoning and session-level memory (personal history
questions across many conversations). Complements MAB's document retrieval.

---

### What to look for in results

1. **Panic cycle counts**: how often does context overflow occur, and does
   the model recover? A high panic rate that still resolves is a success
   story for the system. A high panic rate with 413s is a tuning problem.

2. **Folksonomic quality**: are `known://` paths topic-first and reusable
   across questions, or are they verbatim sentence slugs? Check the DB.

3. **Score vs context pressure**: do rows with larger contexts (more chunks,
   more panics) score lower? If yes, that's the frontier for Step 3.

4. **The 500-token buffer**: watch for any panic loops that still 413 on
   turn 1. If we see them, the buffer needs to increase.

---

### Smart Housekeeping (Step 3)
- Model makes informed decisions about what to demote before hitting 90%
- Step 3 of ENFORCED → FUNCTIONAL → SMART

---

### Community Debut Post (Latent Space)

Publish after Phase 1 (CR full) completes. Tables populated incrementally.

**Post structure:**
1. What Rummy is — memory management yoke, not a RAG system
2. Architecture — hooks/filters, XML tags as plugins, folksonomic `known://` store
3. Fidelity system — full → summary → index → archive, reversible
4. Panic mode — the novel claim: model compresses its own context rather than hard-failing
5. Hardware context — Gemma 4 27B Q3, 32K, local llama, ~45s/chunk
6. What we're not claiming — not competing with frontier models; measuring the delta between hard-413 and a working answer
7. Result tables (MAB CR, MAB AR, LME oracle) — TBD until runs complete
8. Reproducibility block — git clone → .env → test:mab

**Splitting plan:**
- Phase 1: `npm run test:mab -- --split Conflict_Resolution` (CR full, ~10h, 800q, overnight)
- Phase 2: `npm run test:mab -- --split Accurate_Retrieval --row 0` (AR row 0, ~3h, 100q, largest doc)
- Phase 3 (if time): `npm run test:lme -- --split longmemeval_oracle --row 0-49` (~2h, 50q)
- Minimum credible publish threshold: Phase 1 complete + Phase 2 complete = ~900 questions

**Key metrics to surface:**
- Panic recovery rate (panics triggered vs resolved)
- Score vs context pressure correlation
- Folksonomic quality (spot-check known:// paths in DB)

## Active: Budget Simplification

### Design (2026-04-12)

One rule: if context exceeds the 90% ceiling at any checkpoint, demote
and report. The 10% headroom is the system's operating room. No per-write
gating. Tools run uninterrupted; enforcement happens at boundaries.

**Two checkpoints, one pattern:**

1. **Post-dispatch** (Turn Demotion): model's tools all run. Post-dispatch
   check: over ceiling? Demote ALL entries from this turn to summary
   (every scheme except `budget`). Write `budget://` entry listing what
   was demoted. Model sees it next turn and adapts.

2. **Pre-LLM** (Prompt Demotion): new prompt + existing context exceeds
   ceiling. Summarize the prompt. Model runs in the 10% headroom with
   the summarized prompt and manages its own context.

**Safety net**: LLM rejects context on turn 1 (estimate drift) →
`isContextExceeded` catch → same demotion pattern, same headroom.

**AgentLoop recovery**: if pre-LLM 413 can't be resolved by Prompt
Demotion alone, AgentLoop batch-demotes all full entries, writes budget
entry, gives model recovery turns. Strike system: 3 turns without
progress → hard 413 to client. This is the only path where 413 reaches
the client.

**Previous-loop entries**: model-managed via preamble instruction. No
auto-demotion by the system.

### What Changed

**Done (this session):**
- [x] XmlParser: `<known>` tag now spreads all attrs (was dropping `summary`)
- [x] TurnExecutor: passes `attributes` to `upsert()` on both known paths
- [x] Preamble: "folksonomic memory agent" identity, "extract your findings"
- [x] Preamble: summary tags info line, `<previous>` demotion instruction
- [x] Removed auto-demotion of previous loop logging (model-managed now)
- [x] knownDoc: category-level examples, REQUIRED summary, domain-neutral
- [x] All tooldocs: consistent category paths, no single-entity examples
- [x] LLM 400→413: `isContextExceeded` catch in TurnExecutor
- [x] AgentLoop 413 recovery loop (batch demote + budget entry + strikes)
- [x] `demote_turn_entries` SQL: all schemes except budget (was data-only)
- [x] `demote_all_full_data` SQL: includes NULL-scheme file entries
- [x] BudgetGuard class restored (for `delta` utility + `BudgetExceeded` error)
- [x] Unit tests: `isContextExceeded` regex (17 cases), BudgetGuard (11 cases)
- [x] E2E tests: Story 12 (pre-turn recovery), Story 13 (LLM rejection recovery)
- [x] All tests green: 210 unit, 167 integration, 14 E2E

### TODO

**Turn Demotion scope fix:**
- [ ] Verify `demote_turn_entries` covers all schemes correctly in practice
- [ ] Update budget_demotion.test.js for renamed SQL + broader scope
- [ ] Test: logging entries (get, search) at current turn ARE demoted
- [ ] Test: file entries (NULL scheme) promoted by `<get>` ARE demoted

**AgentLoop recovery hardening:**
- [ ] Fix strike counting: consecutive 413s must count strikes even when
  new `budgetRecovery` signals arrive (caused 193-iteration infinite loop)
- [ ] Test: hard-413 fires after 3 consecutive unproductive recovery turns
- [ ] Test: successful demotion by model → recovery exits, prompt restored

**Prompt Demotion:**
- [ ] Verify Prompt Demotion correctly handles both tiny-prompt (context at
  99%) and monster-prompt (context at 75%) cases
- [ ] Test: summarized prompt fits in 10% headroom, model can run

**Demo validation:**
- [ ] Demo run on rummy.nvim project (gemma) — model should read files,
  extract findings into `known://`, manage its own context
- [ ] Verify model doesn't call `<env>` for directory listing (tooldoc
  already says "YOU MUST NOT use <env/> to read or list files")
- [ ] Verify `<previous>` entries get model-written summary tags

**Budget README:**
- [ ] Update `src/plugins/budget/README.md` to reflect new design
  (no per-write BudgetGuard install/uninstall, post-dispatch enforcement)

### Testing Strategy

Write failing tests BEFORE implementing fixes. Each fix gets:
1. A failing test that reproduces the bug
2. The fix that makes it pass
3. Regression coverage going forward

Test locations:
- Unit: `src/**/*.test.js` (alongside source)
- Integration: `test/integration/`
- E2E: `test/e2e/` (real model, never mocked)

## Benchmark Plan

Benchmarks on hold until budget simplification is validated with demo runs.

### Published Baselines (MemoryAgentBench, ICLR 2026)

Source: HUST-AI-HYZ/MemoryAgentBench — arXiv 2507.05257

| Model | CR-SH (single-hop) | CR-MH (multi-hop) |
|---|---|---|
| GPT-4o | 60% | **5%** |
| Claude 3.7 Sonnet | 43% | 2% |
| Gemini 2.0 Flash | 30% | 3% |
| Best published | 60% | **6%** |

### MAB Results (Grok, 32K context, Conflict_Resolution row 0)

- Taxonomy: 7/7 semantic paths, 6/7 keyword-format summaries
- Score: 1/100 (1.0%) — model retrieves correctly but trusts parametric
  knowledge over planted contradictions. CR-MH tests reasoning policy,
  not retrieval quality.
- The retrieval and taxonomy work. The 1% is not a system failure.

Taxonomy health check (fast, no questions):
```
npm run test:grok:taxonomy
npm run test:mab:taxonomy
```

## Deferred

- `src/plugins/progress/progress.js` — add recovery guidance
- Non-git file scanner fallback
- Community debut post (Latent Space) — after budget validation + LME run

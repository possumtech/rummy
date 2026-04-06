# AGENTS: Planning & Progress

> "Is there a rummy way to do this?" Every `<tag>` the model sees is a
> plugin. Every scheme is registered by its owner. Every piece of data
> exists as an entry or a column. No exceptions without documentation.

## Current State

Plugin-driven architecture. Instantiated classes, constructor receives
`core` (PluginContext). Registration via `core.on()` / `core.filter()`.
Assembly via `assembly.system` / `assembly.user` filter chains.
No monolithic assembler. 256 tests passing (159 unit + 97 integration).
10/11 e2e, 22/23 live.

## Todo: Scheme Registration by Plugins

Schemes are hardcoded in `001_initial_schema.sql`. Each plugin should
register its own scheme via `core.registerScheme()`. PluginContext and
`initPlugins` infrastructure is built. Needs:

- [ ] Add `core.registerScheme()` to every tool plugin constructor
- [ ] Remove hardcoded INSERT from migration (table definition stays)
- [ ] Audit schemes bootstrapped by core in `initPlugins`
- [ ] File scheme (`null` scheme for bare paths) — special case, document why
- [ ] Skill scheme registered by skills plugin
- [ ] http/https schemes registered by file plugin or web plugin

## Todo: TurnExecutor Thinning

TurnExecutor is 600 lines. It directly writes audit entries that should
be owned by plugins:

- [ ] `assistant://N` — audit plugin or dedicated assistant plugin
- [ ] `system://N`, `user://N` — telemetry plugin (already captures via filter)
- [ ] `model://N` — telemetry plugin
- [ ] `reasoning://N` — telemetry plugin
- [ ] `content://N` — telemetry plugin
- [ ] `error://N` — error handling plugin
- [ ] `prompt://N`, `ask://N`, `act://N` — prompt plugin
- [ ] `progress://N` — progress plugin
- [ ] `instructions://system` — instructions plugin

Each becomes a plugin subscribing to turn events. TurnExecutor emits
events at checkpoints, plugins write their own entries.

## Todo: ResponseHealer → Hedberg + Core Handler

ResponseHealer is model slop interpretation (hedbergian) mixed with
state machine decisions (core). Split:

- [ ] Move string/syntax interpretation into hedberg plugin
  - "Is this plain text or commands?"
  - "Does this contain investigation tools?"
  - "Is this a tool-only response with no status?"
- [ ] Keep state machine in core ResponseHandler
  - Continue/stop/heal decisions
  - Stall counter
  - Loop detection
  - Calls hedberg for interpretation, makes decisions itself

## Todo: XmlParser → Hedberg Migration

`resolveCommand` in XmlParser does hedbergian format detection inline.
The format-specific parsers (edits, sed, normalize) already moved to
hedberg. Remaining:

- [ ] Move JSON `{ search, replace }` detection to hedberg
- [ ] Move `value` → `body` healing to hedberg/normalize.js (done)
- [ ] Move unrecognized-attr-as-path healing to hedberg/normalize.js (done)
- [ ] Consider moving `resolveCommand` entirely — it's mostly hedberg
      with tool routing glue

## Todo: Skill Plugin Paradigm Fix

Skills plugin bypasses the entry system — does raw DB writes with
`runRow.next_turn` outside any loop context. A skill is just an entry
with two exceptional qualities: (1) sorted to top of context in the
materialized view, (2) body sourced from `~/.rummy/skills/`. The
client adds skills to a run; they aren't included otherwise. Should
go through normal `store.upsert` like everything else.

- [ ] `skills.js` → `skill.js` (matches scheme name, matches convention)
- [ ] Skill registers its own scheme via `core.registerScheme()`
- [ ] Replace raw DB write with `store.upsert` through proper pipeline

## Todo: File Scheme Special Case

The `null` scheme (bare file paths) has no plugin owner. The file plugin
handles projections and scanning but doesn't own the scheme itself
because bare paths have `scheme IS NULL` in the DB. Document this as
a known exception. The file plugin should register a `file` scheme even
though bare paths use NULL — the view maps NULL to 'file' category.

## Todo: Proposal Lifecycle Refactor

The model sends multiple commands in one response. Some go to proposed
(file-scheme rm, set, sh). The current dispatch executes all commands
regardless of proposal state. The resolve path handles proposals one
at a time. This creates a class of bugs:

- Model sends `<rm>file` + `<summarize>file deleted.` — rm goes to
  proposed, summarize claims success. Currently mitigated by overriding
  summarize when proposals exist, but the model's other commands
  (known, set, etc.) after a proposed entry may also assume the outcome.
- Multiple proposals on same turn are resolved independently by the
  user, but commands between proposals may depend on earlier outcomes.
- When a proposal is rejected, commands that followed it in the
  response may be invalid — but which ones? Not all are dependent.

Needs:
- [ ] Design the ordering semantics: which entries after a proposal
      depend on the proposal's outcome?
- [ ] On rejection, invalidate dependent entries with clear error
- [ ] On acceptance, confirm dependent entries were correct
- [ ] Handle interleaved proposals: `<rm>A`, `<set>B`, `<rm>C` where
      A is rejected but C is accepted
- [ ] Summarize/update from a turn with proposals should always be
      held until all proposals resolve

Current mitigation: TurnExecutor overrides summarize when any entry
on the turn is proposed. This prevents the "model claims success"
bug but doesn't handle dependent tool entries.

## Todo: XmlParser Mismatched Close Tag Recovery

When the model sends `<rm path="..."></unknown>` (wrong closing tag),
the parser absorbs all subsequent commands (`<update>`, `<search>`, etc.)
as body text of the unclosed `<rm>`. The flush-on-EOF captures the `<rm>`
but everything after the mismatched close is lost. Fix: when `onclosetag`
sees a known tool name that doesn't match `current.name`, close the
current tag first, then handle the mismatched close.

## Todo: Model rm Path Training Issue

The model tried `<rm path="unknown://specific aspects of...">` with
literal spaces instead of the encoded URI `unknown://specific%20aspects%20...`.
It referenced the entry by its body text, not its path. Two concerns:
(1) the model never sees encoded paths in context — it sees body text —
so it has no way to know the encoded form. (2) Should `<rm>` accept
body text as a match target? The hedberg pattern matching on the path
won't match unencoded text against encoded paths. May need rm to fall
back to body matching, or expose paths in a model-friendly format.

## Todo: Test Improvements

- [ ] Unknown investigation e2e test flaky (model doesn't always register unknowns)
- [ ] Add e2e test for multi-edit sed chaining
- [ ] Add e2e test for ask mode restrictions
- [ ] Integration test for scheme registration via plugins

## Done: Plugin Architecture Refactor

- All 18 plugins converted: static `register(hooks)` → instantiated `constructor(core)`
- PluginContext (`rummy.core`) — plugin-only tier
- ToolRegistry: `ensureTool`, `onView`/`view` (fidelity-keyed), no `register()`
- Assembly filter chain: Known, Previous, Unknown, Current, Progress, Prompt
- ContextAssembler → 30 line orchestrator
- Tool docs → `instructions.toolDocs` filter (each plugin owns its docs.md)
- Preamble → `instructions/preamble.md` (prompt.md deleted)
- Unified API: model/client/plugin use same interface

## Done: xAI Integration

- XaiClient for Responses API (`x.ai/` prefix)
- Cached tokens, reasoning tokens, cost tracking
- `last_run.txt` telemetry dump

## Done: Hedberg Plugin

- Pattern library (hedmatch, hedsearch, hedreplace)
- Heuristic fuzzy matcher
- Sed parsing with escaped delimiters and chaining
- Edit format detection (merge conflict, udiff, Claude XML, JSON)
- Attribute normalization (value→body, unknown-attr→path)
- Full sed regex via native JS RegExp
- `Hedberg.replace()` — single entry point for all replacement operations

## Done: Packet Restructuring

```
[system]
    [instructions — preamble + toolDocs filter + persona]
    <known> — skills first, then by fidelity, then by category
    <previous> — completed loop history
    <unknowns> — unresolved questions
[/system]
[user]
    <current> — active loop work
    <progress> — token budget + unknown count + bridge text
    <ask>/<act> — always last, always present
[/user]
```

## Done: Cleanup

- `RUMMY_MODEL_DEFAULT` removed — model required on every call
- `OPENAI_API_BASE` fallback removed
- Hedberg legacy default export removed
- LlmProvider env fallback removed
- Tilde expansion removed
- Ctags dependency removed from core
- `dedup` replaces `slugPath` for file-targeting schemes
- `read` → `get` in ResponseHealer investigation tools
- File path encoding fix (no slugify on file paths)

## Deferred

- Relevance engine (stochastic, separate project/plugin)
- Hedberg extraction to `@possumtech/rummy.hedberg` npm package
- Janitor plugin (deterministic context budget management)
- Bulk operation aggregation (one entry per pattern operation)
- Non-git file scanner fallback

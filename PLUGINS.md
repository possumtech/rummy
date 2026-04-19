# PLUGINS.md — Plugin Development Guide

Every `<tag>` the model sees is a plugin. Every scheme is registered by
its owner. Every operation — model, client, plugin — flows through the
same tool handler. Exceptions to that discipline must justify themselves
in the architecture spec (SPEC.md).

## §0 Quickstart

A complete tool plugin in four parts: register, handle, render, document.

```js
// src/plugins/ping/ping.js
import docs from "./pingDoc.js";

export default class Ping {
    #core;

    constructor(core) {
        this.#core = core;
        core.ensureTool();
        core.registerScheme({ category: "logging" });
        core.on("handler", this.handler.bind(this));
        core.on("promoted", this.full.bind(this));
        core.on("demoted", this.summary.bind(this));
        core.filter("instructions.toolDocs", async (docsMap) => {
            docsMap.ping = docs;
            return docsMap;
        });
    }

    async handler(entry, rummy) {
        const now = new Date().toISOString();
        await rummy.set({
            path: entry.resultPath,
            body: `pong ${now}`,
            state: "resolved",
            attributes: { path: entry.path },
        });
    }

    full(entry) { return entry.body; }
    summary(entry) { return ""; }
}
```

```js
// src/plugins/ping/pingDoc.js
const LINES = [
    ["## ping",
        "Header — model sees this as the tool name"],
    ["<ping/>",
        "Simplest invocation — no path, no body"],
    ["* Returns server timestamp",
        "One-line description of what the tool does"],
];
export default LINES.map(([text]) => text).join("\n");
```

Install external plugins via npm + env var:

```env
RUMMY_PLUGIN_PING=@myorg/rummy.ping
```

## §1 Plugin Contract

A plugin is a directory under `src/plugins/` containing a `.js` file
that exports a default class. The class name matches the file name.
The constructor receives `core` (a PluginContext) — the plugin's
complete interface with the system.

```js
export default class MyTool {
    #core;

    constructor(core) {
        this.#core = core;
        core.ensureTool();
        core.registerScheme({ category: "logging" });
        core.on("handler", this.handler.bind(this));
        core.on("promoted", this.full.bind(this));
        core.on("demoted", this.summary.bind(this));
        core.filter("instructions.toolDocs", async (docsMap) => {
            docsMap.mytool = docs;
            return docsMap;
        });
    }

    async handler(entry, rummy) {
        // What the tool does (rummy is per-turn RummyContext)
    }

    full(entry)    { return entry.body; }
    summary(entry) { return entry.body; }
}
```

File naming: `src/plugins/mytool/mytool.js`. Class name = file name.
Tool docs: `src/plugins/mytool/mytoolDoc.js` (annotated line arrays).

External plugins install via npm and load via `RUMMY_PLUGIN_*` env vars:

```env
RUMMY_PLUGIN_WEB=@possumtech/rummy.web
RUMMY_PLUGIN_REPO=@possumtech/rummy.repo
```

## §2 Unified API

Three tiers share the tool vocabulary, but the invocation shape and
dispatch path differ.

```
Model:   <rm path="file.txt"/>               → { name: "rm", path: "file.txt" }
                                             → TurnExecutor.#record()
                                             → hooks.tools.dispatch("rm", entry, rummy)
Client:  { method: "rm", params: {...} }     → rpc.js #dispatchRm(...)
                                             → Repository.rm({...})
Plugin:  rummy.rm(path) / rummy.set({...})   → Repository.set / Repository.rm
                                             → (Repository also fires entry events)
```

Three surfaces, one grammar (SPEC §0.3). The model dispatches through
the handler chain (`TurnExecutor.#record()` → `hooks.tools.dispatch`
→ policy filter → turn-scoped recording → abort cascade → budget
lifecycle around it). The client primitives (`set`/`get`/`rm`/`cp`/
`mv`/`update` RPCs) talk directly to Repository — `writer: "client"`
on every call, permissions enforced per-scheme. Plugins use
RummyContext verbs; the `rummy.entries` accessor is a Proxy that
auto-binds `writer: rummy.writer` on every write, so a plugin writing
on behalf of the model gets `writer: "model"` without opt-in.

Plugin code wanting full handler semantics (policy filter, proposal
flow, turn recording) calls `hooks.tools.dispatch` directly instead
of going through a primitive.

Verb signatures vary. See §4.1.

## §3 Registration

All registration happens in the constructor via `core.on()`,
`core.filter()`, `core.ensureTool()`, and `core.registerScheme()`.

### §3.1 core.ensureTool()

Declares this plugin as a model-facing tool. Required for the tool
to appear in the model's tool list. Called automatically by
`core.on("handler", ...)` but must be called explicitly for tools
without handlers (e.g., `update`, `unknown`).

### §3.2 core.registerScheme(config?)

Registers this plugin's scheme in the database. Called once in the
constructor.

```js
core.registerScheme({
    name:         "mytool",                     // defaults to plugin name
    modelVisible: 1,                            // 1 or 0 — appears in v_model_context
    category:     "logging",                    // "data" | "logging" | "unknown" | "prompt"
    scope:        "run",                        // "run" | "project" | "global" — default scope
    writableBy:   ["model", "plugin"],          // subset of: system | plugin | client | model
});
```

All fields optional. `core.registerScheme()` with no args gives a
sensible result-type scheme (logging category, run scope, writable by
model + plugin).

`scope` determines where entries at this scheme land (see SPEC §0.1 /
§0.7). `writableBy` is enforced at `Repository.set` — writes from a
writer not in the list throw a typed `PermissionError` (importable
from `src/agent/errors.js`). The four writer tiers (SPEC §0.4) form
a strict hierarchy: **system > plugin > client > model**. Each tier
is a superset of what's below.

### §3.3 core.on(event, callback, priority?)

| Event | Payload | Purpose |
|-------|---------|---------|
| `"handler"` | `(entry, rummy)` | Tool handler — called when model/client invokes this tool |
| `"promoted"` | `(entry)` | Promoted-fidelity projection — body shown in `<knowns>` / `<performed>` |
| `"demoted"` | `(entry)` | Demoted-fidelity projection — path + summary only (body hidden) |
| `"turn.started"` | `({rummy, mode, prompt, loopIteration, isContinuation})` | Turn beginning — plugins write prompt/instructions entries |
| `"turn.response"` | `({rummy, turn, result, responseMessage, content, commands, ...})` | LLM responded — write audit entries, commit usage |
| `"turn.proposing"` | `({rummy, recorded})` | Tool dispatched — materialize proposals (e.g. file edit 202 revisions) |
| `"turn.proposal"` | `({projectId, run, proposed})` | Proposal awaits client resolution |
| `"turn.completed"` | `(turnResult)` | Turn resolved — full turnResult |
| `"entry.created"` | `(entry)` | Entry created during dispatch |
| `"entry.changed"` | `({runId, path, changeType})` | Entry content, fidelity, or status modified |
| `"run.state"` | `({projectId, run, turn, status, summary, history, unknowns, telemetry})` | Incremental client-facing state push (wire-layer `status` HTTP code stays; DB stores the 5-value state enum) |
| `"error.log"` | `({runId, turn, loopId, message})` | Runtime error — creates an `error://` entry |
| Any `"dotted.name"` | varies | Resolves to the matching hook in `src/hooks/Hooks.js` |

```js
// One-liner examples
core.on("handler", async (entry, rummy) => { /* tool logic */ });
core.on("promoted", (entry) => entry.body);
core.on("demoted", (entry) => entry.attributes?.summary || "");
core.on("turn.started", async ({ rummy, mode }) => { /* write entries */ });
core.on("turn.response", async ({ rummy, result }) => { /* audit */ });
core.on("entry.changed", ({ runId, path, changeType }) => { /* react */ });
```

### §3.4 core.filter(name, callback, priority?)

| Filter | Signature | Purpose |
|--------|-----------|---------|
| `"instructions.toolDocs"` | `(docsMap) → docsMap` | Add tool documentation (docsMap pattern) |
| `"assembly.system"` | `(content, ctx) → content` | Contribute to system message |
| `"assembly.user"` | `(content, ctx) → content` | Contribute to user message |
| `"llm.messages"` | `(messages) → messages` | Transform final messages before LLM call |
| `"llm.response"` | `(response) → response` | Transform LLM response |
| `"llm.reasoning"` | `(reasoning, {commands}) → reasoning` | Contribute to `reasoning_content` (the think plugin subscribes here to merge `<think>` tag bodies) |
| Any `"dotted.name"` | varies | Resolves to the matching filter in the hook tree |

```js
// One-liner examples
core.filter("assembly.system", async (content, ctx) => {
    return `${content}\n<mytag>${myData}</mytag>`;
}, 400);
core.filter("assembly.user", async (content, ctx) => {
    return `${content}\n<status>${myStatus}</status>`;
}, 150);
core.filter("instructions.toolDocs", async (docsMap) => {
    docsMap.mytool = docs;
    return docsMap;
});
```

The `ctx` object passed to assembly filters:

```js
ctx = {
    rows,              // turn_context rows (materialized entries)
    loopStartTurn,     // First turn of current loop
    type,              // "ask" or "act"
    tools,             // Set of active tool names
    contextSize,       // Model context window size
    lastContextTokens, // Assembled tokens from previous turn
}
```

### §3.5 Tool Docs

Each tool plugin has a `*Doc.js` file with annotated line arrays.
Text goes to the model. Rationale stays in source. Registered via
the `instructions.toolDocs` filter using the docsMap pattern:

```js
import docs from "./mytoolDoc.js";

core.filter("instructions.toolDocs", async (docsMap) => {
    docsMap.mytool = docs;
    return docsMap;
});
```

The instructions plugin filters by the active tool set — tools
excluded by mode or flags are automatically omitted from the docs.

### §3.6 handler(entry, rummy)

The handler receives the parsed command entry and a per-turn
RummyContext:

```js
entry = {
    scheme,       // Tool name ("set", "get", "rm", etc.)
    path,         // Entry path ("set://src/app.js")
    body,         // Tag body text
    attributes,   // Parsed tag attributes
    resultPath,   // Where to write the result
}
```

Multiple handlers per scheme. Lower priority runs first. Return
`false` to stop the chain.

### §3.7 full(entry) / summary(entry)

Returns the string the model sees for this tool's entries at the
given fidelity. Every tool MUST register `full`. `summary` is
optional — if unregistered, falls back to `attributes.summary`
(model-authored keyword description) or empty string.

At summary fidelity, `attributes.summary` is prepended above the
plugin's summary output automatically by ToolRegistry.view().

## §4 Two Objects

Plugins interact with two objects at different scopes:

**PluginContext** (`core`) — startup-scoped. Created once per plugin.
Used for registration (`on()`, `filter()`, `registerScheme()`,
`ensureTool()`). Available as `this.#core` throughout the plugin's
lifetime.

**RummyContext** (`rummy`) — turn-scoped. Passed to handlers per
invocation. Has tool verbs, per-turn state, database access.

### §4.1 Tool Verbs (on RummyContext)

Convenience wrappers that bind `runId`, `turn`, `loopId` from context
and delegate to Repository. Signatures vary per verb. For full
handler-chain semantics (policy filtering, proposal flow, abort
cascade), call `rummy.hooks.tools.dispatch(scheme, entry, rummy)`
instead.

| Method | Effect |
|--------|--------|
| `rummy.set({ path?, body?, state?, fidelity?, outcome?, attributes? })` | Create/update entry. If `path` omitted, slugifies from body/summary. State defaults to `"resolved"`. |
| `rummy.get(path)` | Promote entries matching a pattern (default fidelity `"promoted"`). |
| `rummy.rm(path)` | Remove entry's view. |
| `rummy.mv(from, to)` | Rename entry. |
| `rummy.cp(from, to)` | Copy entry to a new path. |
| `rummy.update(body, { status?, attributes? })` | Write the once-per-turn lifecycle signal to `update://<slug>`. |

### §4.2 Query Methods

| Method | Returns |
|--------|---------|
| `rummy.getBody(path)` | Body text or null |
| `rummy.getState(path)` | Categorical state (`"proposed"` \| `"streaming"` \| `"resolved"` \| `"failed"` \| `"cancelled"`) or null |
| `rummy.getOutcome(path)` | Outcome string (populated when state ∈ {failed, cancelled}) or null |
| `rummy.getAttributes(path)` | Parsed attributes `{}` or null |
| `rummy.getEntry(path)` | First matching entry or null |
| `rummy.getEntries(pattern, bodyFilter?)` | Array of matching entries |
| `rummy.setAttributes(path, attrs)` | Merge attributes via json_patch |

### §4.3 Properties

| Property | Type | Notes |
|----------|------|-------|
| `rummy.entries` | Repository proxy | Write calls auto-carry `writer: rummy.writer`. Read-through for reads + internal ops. |
| `rummy.db` | SqlRite db | Prefer `entries` for plugin-facing data access |
| `rummy.hooks` | Hook registry | |
| `rummy.runId` | number | Current run |
| `rummy.projectId` | number | |
| `rummy.sequence` | number | Current turn number |
| `rummy.loopId` / `rummy.turnId` | number | |
| `rummy.type` | `"ask"` \| `"act"` | Current mode |
| `rummy.toolSet` | Set<string> \| null | Active tool list for this loop |
| `rummy.contextSize` | number \| null | Model context window |
| `rummy.systemPrompt` / `rummy.loopPrompt` | string | |
| `rummy.noRepo` / `rummy.noInteraction` / `rummy.noWeb` | boolean | Loop flags |
| `rummy.writer` | `"system"` \| `"plugin"` \| `"client"` \| `"model"` | Default `"model"` in handler dispatch. The Proxy on `rummy.entries` binds this to every write for permission checks (SPEC §0.4). |

## §5 Tool Display Order

Tools are presented to the model in priority order:
gather → reason → act → communicate.

Defined in `ToolRegistry.TOOL_ORDER`. `resolveForLoop(mode, flags)`
handles all exclusions:

| Condition | Excludes |
|-----------|----------|
| `mode === "ask"` | `sh` |
| `noInteraction` flag | `ask_user` |
| `noWeb` flag | `search` |
| `noProposals` flag | `ask_user`, `env`, `sh` |

## §6 Hedberg

The hedberg plugin exposes pattern matching and interpretation
utilities on `core.hooks.hedberg` for all plugins to use:

```js
const { match, search, replace, parseSed, parseEdits,
    generatePatch } = core.hooks.hedberg;
```

| Method | Purpose |
|--------|---------|
| `match(pattern, string)` | Full-string pattern match (glob, regex, literal) |
| `search(pattern, string)` | Substring search |
| `replace(body, search, replacement, opts?)` | Apply replacement |
| `parseSed(input)` | Parse sed syntax (any delimiter) |
| `parseEdits(content)` | Detect edit format (merge conflict, udiff, sed) |
| `generatePatch(path, old, new)` | Generate unified diff |

## §7 Events & Filters

**Events** are fire-and-forget. All handlers run. Return values ignored.
**Filters** transform data through a chain. Lower priority runs first.
All hooks are async.

### §7.1 Project Lifecycle

| Hook | Type | When |
|------|------|------|
| `project.init.started` | event | Before project DB upsert |
| `project.init.completed` | event | After project created |

### §7.2 Run & Loop Lifecycle

| Hook | Type | When |
|------|------|------|
| `run.created` | event | Run just created in DB |
| `ask.started` | event | Run requested in ask mode |
| `act.started` | event | Run requested in act mode |
| `loop.started` | event | Loop execution beginning |
| `run.config` | filter | Before run config applied |
| `run.progress` | event | Status change (thinking, processing) |
| `run.state` | event | After each turn — full state snapshot |
| `run.step.completed` | event | Turn resolved, no proposals pending |
| `loop.completed` | event | Loop execution finished (any exit path) |
| `ask.completed` | event | Ask run finished |
| `act.completed` | event | Act run finished |

### §7.3 Turn Pipeline

Hooks fire in this order every turn:

| # | Hook | Type | When |
|---|------|------|------|
| 1 | `turn.started` | event | Plugins write prompt/instructions entries |
| 2 | `context.materialized` | event | turn_context populated from v_model_context |
| 3 | `assembly.system` | filter | Build system message from entries |
| 4 | `assembly.user` | filter | Build user message (prompt plugin adds `<prompt tokenBudget tokenUsage>`) |
| 5 | `budget.enforce` | call | Measure assembled tokens; if over and it's turn 1, demote prompt, re-materialize, re-check; still over → 413 |
| 6 | `llm.messages` | filter | Transform messages before LLM call |
| 7 | `llm.request.started` | event | LLM call about to fire |
| 8 | `llm.response` | filter | Transform raw LLM response |
| 9 | `llm.request.completed` | event | LLM call finished |
| 10 | `turn.response` | event | Plugins write audit entries (telemetry) |
| 11 | `entry.recording` | filter | Per command, during `#record()`. Returning an entry with `state: "failed"` (or `"cancelled"`) rejects it. |
| 12 | Per recorded entry (sequential, abort-on-failure): | | |
|    | `tool.before` | event | Before handler dispatch |
|    | `tools.dispatch` | — | Scheme's registered handler runs |
|    | `tool.after` | event | Handler finished |
|    | `entry.created` | event | Entry written to store |
|    | `run.state` | event | Incremental state push to connected clients |
|    | `turn.proposing` | event | This entry's dispatch may have created proposals (e.g. set → 202 revisions) |
| 13 | `budget.postDispatch` | call | Re-materialize + check. If over ceiling → Turn Demotion (fidelity=demoted on turn's promoted rows) + write `budget://` entry. |
| 14 | `hooks.update.resolve` | call | Update plugin classifies this turn's `<update>` (terminal/continuation, override-to-continuation if actions failed, heal from raw content if missing) |
| 15 | `turn.completed` | event | Turn fully resolved with final status |

`entry.changed` fires asynchronously from mutation points — not
pipeline-ordered. Subscribe when you need to react to any entry
modification (used by budget remeasurement and file-on-disk detection).

### §7.4 Entry Events

| Hook | Type | When |
|------|------|------|
| `entry.recording` | filter | Before entry stored. Return `{ state: "failed", outcome }` to reject. |
| `entry.created` | event | New entry added during dispatch |
| `entry.changed` | event | Entry content, fidelity, or state modified |

`entry.recording` is a filter — plugins can validate, transform, or
reject entries before they hit the store. Payload:
`{ scheme, path, body, attributes, state, outcome }`. Second arg is
a context bag: `{ store, runId, turn, loopId, mode }`. Return the
entry object (modified or not). Set `state: "failed"` with an
`outcome` string (e.g. `"permission"`, `"validation"`) to reject —
the policy plugin uses this pattern for ask-mode rejections.

`entry.changed` fires on any mutation to an existing entry — body
update, fidelity change, state change, attribute update. Payload:
`{ runId, path, changeType }`. Subscribers include the budget plugin
(remeasure context) and the repo plugin (detect file changes on disk).

### §7.5 Budget

| Hook | Type | When |
|------|------|------|
| `hooks.budget.enforce` | method | Pre-LLM ceiling check. On first-turn 413 → Prompt Demotion + re-check. |
| `hooks.budget.postDispatch` | method | Post-dispatch re-check. On 413 → Turn Demotion + `budget://` entry. |

The budget plugin measures tokens on the assembled messages — the
actual content being sent to the LLM. No estimates at the ceiling,
no SQL token sums. The assembled message IS the measurement. When
turn 2+ information is available, `budget.enforce` prefers the actual
API-reported token count (`turns.context_tokens` from the prior
turn) over re-measuring the assembled string.

**DB tokens vs assembled tokens:** The `tokens` column on `entries`
is strictly for DISPLAY — showing token costs in `<knowns>` tags so
the model can reason about entry sizes. It is NEVER used for budget
decisions. Budget math uses only assembled message token counts.
These are two separate numbers that must never be conflated. See
SPEC §4.5 for the three-measure table.

### §7.6 Client Notifications

| Hook | Type | When |
|------|------|------|
| `ui.render` | event | Text for client display |
| `ui.notify` | event | Status notification |

## §8 Entry Lifecycle

Every entry follows the same lifecycle regardless of origin:

1. **Created** — `entries` row (content) + `run_views` row (per-run
   projection) via the two-prep upsert flow (SPEC §0.7).
2. **Dispatched** — tool handler chain executes.
3. **State set** — handler sets `state` (`"proposed"` \| `"streaming"`
   \| `"resolved"` \| `"failed"` \| `"cancelled"`) + optional
   `outcome` string on the `run_views` row. State is view-side; body
   is content-side. (SPEC §0.1)
4. **Materialized** — `v_model_context` joins entries + run_views,
   projects into `turn_context`.
5. **Assembled** — filter chain renders into system/user messages.
   Model-facing tags carry `status="NNN"` (HTTP code) via
   `src/agent/httpStatus.js`'s state-to-HTTP mapping — the model's
   vocabulary is HTTP; the DB is categorical.
6. **Visible** — model sees the entry in its context.

Entries at `fidelity = 'archived'` skip steps 4–6 (invisible to
model, discoverable via pattern search). Entries at `fidelity =
'demoted'` render with `attributes.summary` (model-authored keyword
description) prepended above the plugin's `demoted` view output —
the body is hidden; promoting with `<get>` brings it back.

**Per-plugin fidelity projection reference.** Each plugin chooses
what its `promoted` / `demoted` view hooks return. Renderers trust
the projected body — they do NOT re-check `entry.fidelity`.

| Plugin | Category | `promoted` body | `demoted` body | Notes |
|--------|----------|-----------------|----------------|-------|
| `known` | data | `entry.body` | `""` | Tag's `summary` attr carries the keywords at demoted fidelity |
| `unknown` | unknown | `entry.body` | `""` | Same pattern as known |
| `prompt` | prompt | `entry.body` | 500-char truncation with `[truncated — promote to see the complete prompt]` marker | |
| `budget` | logging | `entry.body` | `entry.body` | Feedback signal — kept visible |
| `update` | logging | `# update\n${entry.body}` | same as promoted | Already 80-char capped by tool doc rule |
| `get` / `set` / `rm` / `cp` / `mv` / `sh` / `env` / `search` | logging | result body | `""` | Just the self-closing tag at demoted |
| `skill` | data | `entry.body` | `""` | Same as known |
| `file` (bare paths) | data | `entry.body` | `""` | Same as known |

Plugins providing only a `promoted` hook fall back to
`attributes.summary` (model-authored keyword description) at demoted;
the renderer inserts it automatically. Plugins providing neither
default to empty body — the tag still renders with its attributes so
the model can pattern-match the path.

### §8.1 Streaming Entries

Producers whose output arrives over time (shell commands, web fetches,
log tails, file watches) use the **streaming entry pattern**. The
lifecycle extends beyond 202→200:

```
state: "proposed" (user decision pending)
  → accept → state: "resolved" (log entry: action happened)
           + state: "streaming" data entries (one per channel, growing)
                  → "resolved" / "failed" on completion
```

**Producer plugin contract:**

1. On dispatch, create a **proposal entry** at `{scheme}://turn_N/{slug}`
   with `state: "proposed"`, category=logging. Body empty;
   `summary=command` attr.
2. On user accept (client sends `set { state: "resolved" }` on the
   proposal path), `AgentLoop.resolve()` transitions the proposal
   entry to `state: "resolved"` (it becomes the **log entry**) and
   creates **data entries** at `{path}_1`, `{path}_2`, etc. with
   `state: "streaming"`, category=data, fidelity=demoted, empty body.
3. Producer/client calls `stream { run, path, channel, chunk }` RPC
   to append chunks to the appropriate channel.
4. When the producer is done, `stream/completed { run, path, exit_code? }`
   transitions all `{path}_*` data entries to a terminal state
   (`"resolved"` on exit_code=0 or omitted; `"failed"` with outcome
   `"exit:N"` otherwise) and rewrites the log entry body with final
   stats. For client-initiated cancellation, the client calls
   `stream/aborted { run, path, reason? }` instead — transitions
   channels to `state: "cancelled"` with outcome=reason.

**Channel numbering:** Unix file descriptor convention — `_1` is the
primary stream (stdout for shell, body for fetch, lines for tail);
`_2` is alternate/error (stderr, redirects, anomalies); `_3`+ for
additional producer-specific streams.

**The `stream` plugin** owns the RPC infrastructure. Producer plugins
only need to:
- Create the proposal entry on dispatch (status=202)
- Rely on `AgentLoop.resolve()` to create data channels on accept
- Let clients/external producers call `stream`, `stream/completed`,
  and `stream/aborted`

No scheme registration or tooldoc for the stream plugin itself — it's
pure RPC plumbing shared across all streaming producers.

## §9 Bundled Plugins

| Plugin | Type | Description |
|--------|------|-------------|
| `get` | Core tool | Load file/entry into context |
| `set` | Core tool | Edit file/entry, fidelity control |
| `known` | Core tool + Assembly | Save knowledge, render `<knowns>` section |
| `rm` | Core tool | Delete permanently |
| `mv` | Core tool | Move entry |
| `cp` | Core tool | Copy entry |
| `sh` | Core tool | Shell command (act mode only). Streaming producer — see §8.1 |
| `env` | Core tool | Exploratory command. Streaming producer — see §8.1 |
| `stream` | Internal | Generic streaming-entry RPC (`stream`, `stream/completed`, `stream/aborted`, `stream/cancel`) for sh/env and future producers |
| `ask_user` | Core tool | Ask the user |
| `search` | Core tool | Web search (via external plugin) |
| `update` | Structural | Status report + lifecycle signal. `status="200\|204\|422"` terminates; `status="102"` continues. Exposes `hooks.update.resolve` for TurnExecutor. |
| `unknown` | Structural + Assembly | Register unknowns, render `<unknowns>` |
| `previous` | Assembly | Render `<previous>` loop history |
| `performed` | Assembly | Render `<performed>` active loop work |
| `prompt` | Assembly | Render `<prompt mode="ask\|act" tokenBudget="N" tokenUsage="M">` tag |
| `hedberg` | Utility | Pattern matching, interpretation, normalization |
| `instructions` | Internal | Preamble + tool docs + persona assembly; exposes `hooks.instructions.resolveSystemPrompt` |
| `file` | Internal | File entry projections and constraints (`scheme IS NULL`) |
| `rpc` | Internal | RPC method registration + tool-fallback dispatch |
| `telemetry` | Internal | Audit entries, usage stats, reasoning_content |
| `budget` | Internal | Context ceiling enforcement: Prompt Demotion (pre-LLM first-turn 413) + Turn Demotion (post-dispatch). Exposes `hooks.budget.enforce` / `hooks.budget.postDispatch`. |
| `policy` | Internal | Ask-mode per-invocation rejections via `entry.recording` filter |
| `error` | Internal | `error.log` hook → `error://` entries |
| `think` | Tool | Private reasoning tag; contributes to `reasoning_content` via the `llm.reasoning` filter |
| `openai` / `ollama` / `xai` / `openrouter` | LLM provider | Register with `hooks.llm.providers`; handle `{prefix}/...` model aliases. Silently inert if their env isn't configured. |
| `persona` / `skill` | Internal | Runtime persona/skill management via RPC |

## §10 External Plugins

| Plugin | Package | Description |
|--------|---------|-------------|
| Repo | `@possumtech/rummy.repo` | Git-aware file scanning and symbol extraction |
| Web | `@possumtech/rummy.web` | Web search and URL fetching via searxng |

Loaded via `RUMMY_PLUGIN_*` env vars. External plugins have access
to the same PluginContext API as bundled plugins.

## §11 RPC Methods

Client-facing JSON-RPC 2.0 over WebSocket. Protocol version **2.0.0**.
The client surface is a thin projection of the plugin API (SPEC §0.3):
the six primitives match the plugin's `rummy.set` / `rummy.get` / etc.
exactly, plus a connection handshake and a few config verbs.

### §11.1 Wire Format

```json
// Request
{ "jsonrpc": "2.0", "id": 1, "method": "set", "params": { "run": "my_run", "path": "known://fact", "body": "...", "state": "resolved" } }

// Success response
{ "jsonrpc": "2.0", "id": 1, "result": { "ok": true } }

// Error response
{ "jsonrpc": "2.0", "id": 1, "error": { "code": -32603, "message": "set: path is required" } }

// Notification (server → client, no id)
{ "jsonrpc": "2.0", "method": "run/state", "params": { "run": "my_run", "turn": 3, "status": 200, ... } }
```

### §11.2 Connection Handshake

First call every client makes. Establishes project identity and
enforces protocol-version compatibility.

| Method | Params | Notes |
|--------|--------|-------|
| `rummy/hello` | `{ name, projectRoot, configPath?, clientVersion? }` | Returns `{ rummyVersion, projectId, projectRoot }`. Server rejects MAJOR mismatch with a protocol-mismatch error. |

### §11.3 Primitives (SPEC §0.2)

Six verbs. Object-args matching the entry grammar. Writer is fixed to
`"client"` server-side; permissions enforced per-scheme via the
scheme's `writable_by`.

| Method | Params | Notes |
|--------|--------|-------|
| `set` | `{ run, path, body?, state?, fidelity?, outcome?, attributes?, append?, pattern?, bodyFilter? }` | Wide semantic: write content, change fidelity/state, merge attributes, append (streaming), pattern update. Writing to `run://<alias>` starts or cancels a run (see §11.4). State transitions on proposed entries route through `AgentLoop.resolve()` for scheme-specific side effects. |
| `get` | `{ run, path, bodyFilter?, fidelity? }` | Promote an entry (or pattern) to visible fidelity. |
| `rm` | `{ run, path, bodyFilter? }` | Remove entry's view. |
| `cp` | `{ run, from, to, fidelity? }` | Copy entry to new path. |
| `mv` | `{ run, from, to, fidelity? }` | Rename entry. |
| `update` | `{ run, body, status?, attributes? }` | Write the once-per-turn lifecycle signal to `update://<slug>`. |

### §11.4 Run Lifecycle via Primitives

Runs are addressable as `run://<alias>` entries (SPEC §0.5). The
client manipulates run lifecycle via ordinary `set` calls:

| Action | Call |
|--------|------|
| Start a run (named) | `set { path: "run://<alias>", body: <prompt>, attributes: { model, mode?, persona?, temperature?, contextLimit?, noRepo?, noInteraction?, noWeb?, noProposals? } }` |
| Start a run (anonymous) | `set { path: "run://", body: <prompt>, attributes: { model, ... } }` — server synthesizes alias as `${model}_${unixEpochMs}` and returns it in the response |
| Cancel a run | `set { path: "run://<alias>", state: "cancelled" }` |
| Inject continuation | `set { path: "run://<alias>", body: <message> }` on an existing run |
| Accept a proposal | `set { run, path: "<entry>", state: "resolved", body?: <output> }` |
| Reject a proposal | `set { run, path: "<entry>", state: "cancelled", body?: <reason> }` |

Starting a new run is fire-and-forget: server returns `{ ok: true, alias }`
immediately; client watches the run's state transitions via the
`run/state` notification (and the `run://` entry itself).

### §11.5 Config & Query Methods

Not every server capability fits the entry grammar. These are
dedicated verbs with 1:1 plugin-API equivalents.

| Method | Params | Notes |
|--------|--------|-------|
| `ping` | — | Liveness check |
| `discover` | — | Return the live RPC catalog |
| `getModels` / `addModel` / `removeModel` | (see rpc.js) | Model aliases |
| `getRuns` / `getRun` | `{ limit?, offset? }` / `{ run }` | Run listing and detail |
| `getEntries` | `{ run, pattern?, scheme?, state?, fidelity?, bodyFilter? }` | Read-only entry query. Returns `[{path, scheme, state, fidelity, attributes, turn, tokens}]`. No promotion side-effect. Pair with `get` primitive (which is a write verb). |
| `file/constraint` | `{ pattern, visibility }` | Project-scoped: set overlay. `visibility ∈ {active, readonly, ignore}`. Patterns can be globs. `readonly` is enforced on `set://` accept in `AgentLoop.resolve()`. |
| `file/drop` | `{ pattern }` | Project-scoped: remove overlay row. |
| `getConstraints` | — | Project-scoped: returns `[{pattern, visibility}]`. |
| `skill/add` / `skill/remove` / `getSkills` / `listSkills` | | Skill management |
| `persona/set` / `listPersonas` | | Persona management |
| `stream` / `stream/completed` / `stream/aborted` / `stream/cancel` | | Streaming RPC (§8.1) |

**Why file constraints are typed RPCs and not `set` entries:** they
are project-scoped (no `run`), persist across runs, and `readonly`
requires enforcement server-side on `set://` accept. Every `set`
primitive call requires a run alias; constraints don't have one. The
typed verbs match the capability's actual shape rather than contorting
the grammar.

### §11.6 Notifications (server → client)

| Method | Purpose |
|--------|---------|
| `run/state` | Incremental state push per tool dispatch |
| `run/progress` | Turn status transition (`thinking` / `processing`) |
| `run/proposal` | A proposed entry awaits client resolution |
| `stream/cancelled` | Server-initiated streaming cancellation |
| `ui/render` | Streaming UI output |
| `ui/notify` | Toast notification |

### §11.7 Retired Methods (2.0.0)

Protocol 1.x shipped many methods that collapsed into the primitive
grammar. Clients migrating from 1.x need to replace the following:

| 1.x method | Replacement |
|------------|-------------|
| `init` | `rummy/hello` |
| `ask` / `act` / `startRun` | `set { path: "run://<alias>", body: <prompt>, attributes: { model, mode, ... } }` |
| `run/resolve` | `set { run, path, state, body? }` |
| `run/abort` / `run/cancel` | `set { path: "run://<alias>", state: "cancelled" }` |
| `run/rename` | `mv { run, from: "run://<old>", to: "run://<new>" }` |
| `run/inject` | `set { path: "run://<alias>", body: <message> }` on an existing run |
| `run/config` | `set { path: "run://<alias>", attributes: { ... } }` |
| `store` (demote) | `set { run, path, fidelity: "demoted", pattern: true }` |
| `getEntries` | Kept as §11.5 typed helper — now filter-capable (scheme/state/fidelity). Pairs with the `get` write primitive. |
| `get { persist }` / `store { persist, clear, ignore }` (file constraints) | `file/constraint { pattern, visibility }` and `file/drop { pattern }`. Project-scoped helpers in §11.5 with real server enforcement for `readonly`. |

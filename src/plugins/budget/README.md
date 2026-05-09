# budget {#budget_plugin}

Context ceiling enforcement.

## Design

Ceiling = `floor(contextSize × RUMMY_BUDGET_CEILING)` (default 0.9). The
10% headroom is the system's operating room for graceful overflow
handling. No per-write gating — tools run uninterrupted. Enforcement
happens at one boundary: the pre-LLM grinder.

## Single source of truth

`tokenUsage` and `tokensFree` are one number derived from one helper:

```js
computePacketTokens({ system, user })
  → tokenUsage = countTokens(system) + countTokens(user)
```

This is what the **`<budget>`** tag shows the model AND what the
`turn.beforeDispatch` enforce gate measures (when no prior-turn
`prompt_tokens` is available; otherwise enforce uses that real API
count). The two never diverge — they reach for the same function
against the same assembled bytes.

## How `<budget>` is rendered

`assembleBudget` runs at `assembly.user` priority 90. It emits the
breakdown table (per-scheme `aTokens` sums) and writes the
**placeholder** `<budget>` tag:

```
<budget tokenUsage="{{tokenUsage}}" tokensFree="{{tokensFree}}">
… per-scheme breakdown table …
System: {{systemTokens}} tokens.
Total: …
</budget>
```

`ContextAssembler.assembleFromTurnContext` then assembles both
messages, calls `computePacketTokens`, and substitutes the placeholders
in-place. Single pass: assemble → measure → substitute → return.

The breakdown table values (per-scheme `aTokens`, summarized aggregate,
visible/summarized counts) are independent of the headline math. They
come from row-level measurements done at materialization time. The
headline is wire truth; the table is the action map.

## Enforcement Points

1. **Pre-LLM grinder** (`turn.beforeDispatch` filter): four-step
   ladder per SPEC §budget_enforcement.

   1. Check budget. If under ceiling → proceed.
   2. Soft 413: demote `(current_turn − 1)` visible run_views to
      `summarized` (all schemes, no exemption). Re-materialize, recheck.
   3. Soft 413: demote the incoming `prompt://N` to `summarized`.
      Re-materialize, recheck.
   4. Hard 413: emit `error://`, set `ok=false` on the packet so
      TurnExecutor short-circuits dispatch.

   Steps 2 and 3 also emit `error://` 413 entries when they fire so
   the model sees what was auto-demoted next turn. The grinder never
   demotes speculatively or helpfully — only in response to actual
   overflow.

2. **LLM rejection** (`isContextExceeded` in TurnExecutor): turn-1
   token-estimate drift causes the LLM to reject. Same 413 error path
   as the grinder's hard step.

## Files

- **budget.js** — Plugin. Math (`ceiling`, `measureMessages`,
  `measureRows`, `computeBudget`, **`computePacketTokens`**), 413
  body shaper (`overflowBody`), and the plugin class itself.

## Hook participation

- `core.filter("turn.beforeDispatch", ...)` — pre-LLM grinder.
  Returns the (possibly demoted) packet with `ok` / `overflow` flags.
- `core.filter("assembly.user", ..., 90)` — renders the `<budget>`
  table + placeholder tag into the user message.

Emits 413 errors through the unified error channel
(`hooks.error.log.emit`); there is no separate `budget://` scheme.

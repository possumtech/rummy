# budget {#budget_plugin}

Context ceiling enforcement and `<turn>` per-turn meta tag.

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

This is what the **`<turn>`** tag shows the model AND what the
`turn.beforeDispatch` enforce gate measures (when no prior-turn
`prompt_tokens` is available; otherwise enforce uses that real API
count). The two never diverge — they reach for the same function
against the same assembled bytes.

## How `<turn>` is rendered

`assembleTurn` runs at `assembly.user` priority 90. It emits:

- **Attrs**: `commands` (per-mode tool list), `warn` (ask-mode), `archived`
  (count from prior turn's grinder fire), `tokenUsage`/`tokensFree`
  placeholders.
- **Body**: per-scheme breakdown table (`indexed | archived | tokens`)
  + total prose line.

```
<turn commands="get,set,…" tokenUsage="{{tokenUsage}}" tokensFree="{{tokensFree}}">
| scheme | indexed | archived | tokens |
|---|---|---|---|
| known | 2 | 0 | 60 |
| https | 1 | 0 | 420 |
…
Total: N indexed + M archived entries; tokenUsage {{tokenUsage}} / ceiling C. {{tokensFree}} tokens free.
</turn>
```

`ContextAssembler.assembleFromTurnContext` then assembles both
messages, calls `computePacketTokens`, and substitutes the placeholders
in-place. Single pass: assemble → measure → substitute → return.

## Grinder (S10)

1. Check budget. Under ceiling → proceed.
2. Collect fat replays: `<get>` / `<set>` log entries from turns
   `< current` that have non-empty bodies.
3. Sort by `(turn DESC, body_tokens DESC)` — newest+biggest first.
4. Walk list. For each: clear body, status=413 (state=failed,
   outcome=budget). Stop when under budget.
5. Synthesize one summary `error` log entry on the current turn with
   manifest of reclaimed paths (S8 format).
6. List exhausted, still over: hard 413, no further compaction.

Only fat replays are touched. Catalog entries (knowns, files, streams,
URLs) are never auto-archived — visibility is model-only via
`<set archive/>` / `<set index/>`. Slim manifests (sh/mv/cp/rm/etc.)
have empty bodies, no fat to reclaim.

## Files

- **budget.js** — Plugin. Math (`ceiling`, `measureMessages`,
  `measureRows`, `computeBudget`, **`computePacketTokens`**), 413
  body shaper (`overflowBody`), `<turn>` renderer (`assembleTurn`),
  grinder (`enforce`).

## Hook participation

- `core.filter("turn.beforeDispatch", ...)` — pre-LLM grinder.
  Returns the (possibly slimmed) packet with `ok` / `overflow` flags.
- `core.filter("assembly.user", ..., 90)` — renders `<turn>` into the user message.

Emits 413 errors through the unified error channel
(`hooks.error.log.emit`); there is no separate `budget://` scheme.

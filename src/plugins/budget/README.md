# budget {#budget_plugin}

Context ceiling enforcement.

## Design

Ceiling = `floor(contextSize × RUMMY_BUDGET_CEILING)` (default 0.9). The
10% headroom is the system's operating room for graceful overflow
handling. No per-write gating — tools run uninterrupted. Enforcement
happens at one boundary: the pre-LLM grinder.

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
  `measureRows`, `computeBudget`), 413 body shaper (`overflowBody`),
  and the plugin class itself.

## Hook participation

- `core.filter("turn.beforeDispatch", ...)` — pre-LLM grinder. Returns
  the (possibly demoted) packet with `ok` / `overflow` flags.
- `core.filter("assembly.user", ..., 175)` — renders the `<budget>`
  table into the user message.

Emits 413 errors through the unified error channel (`hooks.error.log.emit`);
there is no separate `budget://` scheme.

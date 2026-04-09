# budget

Context ceiling enforcement. Returns 413 when assembled tokens exceed
the model's context window.

## Registration

- **Hook**: `hooks.budget.enforce` — called by TurnExecutor after assembly.

## Behavior

Measures `countTokens()` on assembled messages — the actual content
being sent to the LLM. If assembled tokens exceed context size, returns
status 413 with overflow count. The turn aborts without calling the LLM.

The model owns its context. Budget provides the ceiling and advisory
warnings (via progress plugin). No automatic demotion or crunch.

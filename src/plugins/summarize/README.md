# summarize

Lifecycle signal — the model declares it has completed the task.

## Registration

- **Tool**: `summarize`
- **Category**: `logging`
- **Handler**: None — recorded by TurnExecutor as a lifecycle signal.

## Projection

Shows `summarize` followed by the entry body.

## Behavior

If the model sends `<summarize>` but actions in the same turn failed,
TurnExecutor overrides it to `<update>` — the model's assertion that
it's done is false.

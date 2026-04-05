# previous

Renders the `<previous>` section of the system message — completed loop
history from prior ask/act invocations on this run.

## Registration

- **Filter**: `assembly.system` at priority 200
- **Condition**: Omitted when `loopStartTurn <= 1` (first loop has no history)

## Behavior

Filters turn_context rows where `category` is `result` or `structural`
and `source_turn < loopStartTurn`. Renders each entry chronologically
with status symbols (✓/✗/·).

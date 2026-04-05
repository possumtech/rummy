# current

Renders the `<current>` section of the user message — the active loop's
model responses, tool results, and agent warnings.

## Registration

- **Filter**: `assembly.user` at priority 100

## Behavior

Filters turn_context rows where `category` is `result` or `structural`
and `source_turn >= loopStartTurn`. Renders each entry chronologically
with status symbols. Empty on the first turn of a loop.

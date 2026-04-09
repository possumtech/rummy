# current

Renders the `<current>` section of the user message — the active loop's
tool results and lifecycle signals.

## Registration

- **Filter**: `assembly.user` at priority 100

## Behavior

Filters turn_context rows where `category === "logging"` and
`source_turn >= loopStartTurn`. Renders each entry chronologically
with turn number and status. Empty on the first turn of a loop.

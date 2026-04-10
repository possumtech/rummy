# previous

Renders the `<previous>` section of the system message — completed loop
history from prior ask/act invocations on this run.

## Registration

- **Filter**: `assembly.system` at priority 200
- **Condition**: Omitted when `loopStartTurn <= 1` (first loop has no history)

## Behavior

Filters turn_context rows where `category` is `logging` or `prompt`
and `source_turn < loopStartTurn`. Renders each entry chronologically
with turn, status, summary, fidelity, and tokens. The model can target
these entries by path with `<set>` or `<rm>` to free context space.

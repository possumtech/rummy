# prompt

Renders the `<ask>` or `<act>` tag at the end of the user message.
Always present on every turn — the model always sees its task.

## Registration

- **Filter**: `assembly.user` at priority 300 (always last)

## Behavior

Finds the latest `ask://` or `act://` entry in the turn_context rows.
Renders with `tools` attribute (available tool list) and optional `warn`
attribute in ask mode ("File and system modification prohibited on this
turn."). Falls back to the mode passed by the core if no prompt entry
exists.

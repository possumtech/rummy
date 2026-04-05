# progress

Renders the `<progress>` section of the user message — bridges the
current work log to the active prompt.

## Registration

- **Filter**: `assembly.user` at priority 200

## Behavior

On first turn: "Begin."
On continuation turns with current entries: "The above actions were
performed in response to the following prompt:"
If a `progress://` entry exists, uses its body directly.

Progress text is the tuning knob for model orientation between turns.

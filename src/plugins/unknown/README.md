# unknown {#unknown_plugin}

The Rumsfeld mechanism. The model registers what it doesn't know before acting.

`<unknown>which database adapter is configured</unknown>`

## Registration

- **Tool**: `unknown`
- **Category**: `data` — unknowns are catalog entries; they appear in
  `<index>` alongside knowns/files/streams (S2a).
- **Handler**: Records the unknown body at a slugged `unknown://` path, dedupes against existing unknowns.
- **View**: returns the entry body verbatim — full-body tile in `<index>`.

## Behavior

Unknowns are sticky — they persist across turns until the model explicitly
removes them with `<rm>` or `<set archive/>`. The model investigates unknowns
using `<get>`, `<env>`, or `<ask_user>`, then archives or removes resolved
ones. Server deduplicates on insert.

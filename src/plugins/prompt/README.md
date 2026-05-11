# prompt {#prompt_plugin}

Records each turn's prompt as both a catalog entry (archived by
default) and a log entry (with body = ≤500-char preview). No
`<prompt>` section — the active task surfaces as the last `<log>`
entry by recency.

## Registration

- **Scheme**: `prompt`, category `data`, `writableBy: ["plugin"]` —
  the model can't `<set path="prompt://N">` body content directly,
  but visibility flips (`archive`/`index`) work like any catalog entry.
- **View**: returns the entry body verbatim (used both for the
  catalog tile when indexed and for `<get path="prompt://N">`
  retrievals into `<log>`).
- **Event**: `turn.started` — writes both entries.

## What turn.started writes

For each new (non-continuation) prompt:

1. `prompt://N` — catalog entry, full body, `visibility: "archived"`.
   Hidden from `<index>` by default. Recallable via
   `<get path="prompt://N">` or `<set path="prompt://N" index/>`.

2. `log://<L>/<T>/<S>/prompt` — log entry, body = ≤500-char
   preview, `attrs.path = "prompt://N"`. The log preview is the
   active-task signal: under the slim-log paradigm, body-bearing
   log entries pop out of a wall of slim manifests, and the latest
   prompt entry is naturally last in `<log>` (recency).

## Why archived by default

Older prompts are time-tape items, not reference catalog. Mixing
them with knowns/files/streams in `<index>` would muddle the
catalog's role. Archived means hidden from `<index>` but present
in storage — model retrieves freely.

## Why the 500-char preview cap

Bounded log cost. If the prompt is more of a data packet than an
instruction, the model `<get>`s `prompt://N` for the full body.
The cap is a fixed render rule, not a budget reaction.

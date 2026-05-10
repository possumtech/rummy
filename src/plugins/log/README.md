# log {#log_plugin}

Assembles the `<log>` block in the user message: every
`category="logging"` entry from past turns, rendered as XML tool tags
in v_model_context sort order. Active task = the last entry.

## Registration

- **Filter**: `assembly.user` priority 50 — between persona (10)
  and `<turn>` (90).

## Rendering

Each logging entry renders with its scheme as the tag name (`<get>`,
`<set>`, `<search>`, `<rm>`, `<cp>`, `<mv>`, `<sh>`, `<env>`,
`<update>`, `<ask_user>`, `<error>`, `<prompt>`). Attributes:
`action`, `target`, `status`, `outcome`, `command`, `query`, `tokens`,
`lines`, etc.

## Body shape (S5–S6)

Bodies are **optional**. Default is empty — just the JSON envelope.

**Body present:**
- `<set>` — verbatim model emission, tab-indented. Always.
- `<get>` — retrieved content (the explicit fat-fetch verb).
- `<search>` — manifest format URL listing.
- `<error>` — error description.
- `<update>` — short prose status.
- `<prompt>` — ≤500-char preview of the prompt content.

**Body empty:**
- `<sh>` / `<env>` recap — command in attrs; stream output in `<index>`
  via `sh://N` / `env://N` data tiles.
- `<mv>` / `<cp>` / `<rm>` — op + path in attrs.
- `<ask_user>` — Q+A in attrs.

## `tokens=` invariant

`tokens=` reflects the entry's own body cost. Slim recaps with empty
body omit `tokens=` entirely. Body-bearing entries surface
`countTokens(body)`. Linked data entries (via `attrs.path`) have their
own tile in `<index>` with their own meta; the log doesn't double-count.

## Behavior

No loop-boundary split. The `turn` attribute on every entry carries
when it happened; the model derives loop membership from the data if
it matters. One chronological log from turn 1 to now.

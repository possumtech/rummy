# known {#known_plugin}

Writes model-authored knowledge entries to `known://` paths and
renders the catalog's `<index>` block at the top of the system message.

## Registration

- **Tool**: `known`
- **Category**: `data`
- **Handler**: Upserts the entry body at the target path with status 200.
- **View**: registered to return the entry body verbatim — knowns are
  full-body tiles in `<index>` (S2). Models author them short by intent.
- **Filter**: `assembly.system` priority 200 — renders `<index>` from
  every catalog entry (any scheme with `category: "data"`).

## `<index>` assembly

Filters `ctx.rows` where `category === "data"` and `visibility === "indexed"`.
Renders each as a heredoc tile: JSON envelope + tab-indented body
(per the plugin's view projection). Stable schemes appear first;
volatile schemes (sh/env streams) sort to the bottom for cache.

Third-party plugins that register with `category: "data"` (and an
`onView` hook for the projection shape) appear in `<index>` automatically.

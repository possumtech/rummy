# set {#set_plugin}

Writes or edits entry content. Handles new files, full overwrites,
SEARCH/REPLACE edits, and pattern updates.

## Files

- **set.js** — Plugin registration and edit dispatch logic.
- **HeuristicMatcher.js** — Fuzzy SEARCH/REPLACE matching.
- **HeuristicMatcher.test.js** — Tests for HeuristicMatcher.

## Registration

- **Tool**: `set`
- **Category**: `logging`
- **Handler**: Routes based on attributes:
  - `blocks` or `search` — SEARCH/REPLACE edit via `processEdit`.
  - `manifest` — pattern manifest (lists matches without performing the set).
  - Scheme path — direct upsert at status 200.
  - File path — produces status 202 (proposed) with unified diff patch.
  - Glob/filter — bulk update via `updateBodyByPattern`.

## Projection

Log entry body is the trimmed udiff (no `---`/`+++` header,
`context: 0`) — the canonical, training-friendly shape the model
reads back from `<log>`. Conflict entries synthesize an error
projection with `attempted` + `current body` blocks.

## Behavior

- **Literal match first**: SEARCH text is matched literally.
- **Heuristic fallback**: On literal failure, fuzzy matching with warnings.
- **Patch generation**: `generateBodyUdiff` produces the model-facing
  trimmed udiff stored as the log entry body. `generatePatch` produces
  the full unified diff stashed in `attrs.patch` for client renderers
  (rummy.nvim, web UI).
- File writes are always status 202 (proposed); scheme writes resolve immediately.
- **`proposal.content` filter** — when the client accepts a proposed
  set, this plugin overrides the resolved body to the body it
  already staged on the audit entry (rather than whatever literal
  body the client passed through `resolve`).

# instructions {#instructions_plugin}

Projects the model-facing instructions into the assembled packet.
Split into a stable system-side base and a per-turn user-side
imperative reminder so prompt caching holds across turns within a
run.

## Registration

- **Filter**: `assembly.system` (priority 50) — renders the system-
  prompt header + Core XML Command Grammar from
  `instructions-system.md` with `[%TOOLS%]` substituted to the
  active-toolset tag list.
- **Filter**: `assembly.system` (priority 100) — renders the joined
  per-tool docs. Each tool plugin contributes its block via the
  `instructions.toolDocs` sub-filter (registry-style: filter
  participants mutate a docsMap keyed by tool name). Render order
  follows tool-registration order.
- **Filter**: `assembly.user` (priority 165) — renders
  `instructions-user.md` as `<system_requirements>` at the bottom
  of the user message, after `<turn>` (90). The user message is
  ordered persona → `<log>` (50) → `<turn>` (90) → `<system_requirements>` (165),
  so per-turn protocol reminders land last and the model reads them
  with recency.
- **Filter**: `instructions.toolDocs` — sub-filter the toolDocs
  participant calls. Tool plugins (and skill) extend this filter
  to publish their per-tool docs.
- **Hook**: `hooks.instructions.findLatestSummary` — locates the
  most recent `<update status="200">` for cli.js to print as the
  run's final answer.

The persona block is rendered by the persona plugin's own
`assembly.system` participant at priority 150.

## Files

- `instructions.js` — plugin registration and per-section assembly.
- `instructions-system.md` — header + Core XML Command Grammar.
  Static within a run; only `[%TOOLS%]` substitutes at render. No
  per-turn content here, ever.
- `instructions-user.md` — the per-turn imperative reminder
  rendered as `<system_requirements>` in the user message. Same bytes
  every turn.
- `protocol.js` / `protocol.test.js` — pass-through stub on
  `entry.recording` (priority 1) reserved for future
  deterministic protocol rule enforcement.

## Cache shape

The full system prompt (header + Core grammar + tool docs +
persona) is built by the `assembly.system` chain. Each participant
returns identical bytes across all turns of a run, so the
concatenated result is byte-stable → cache-stable. If you add a
per-turn-dynamic piece to any system-side participant by mistake,
the system prompt changes every turn and the cache prefix
collapses. Per-turn content belongs in the user message.

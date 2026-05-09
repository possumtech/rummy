# unknown {#unknown_plugin}

The Rumsfeld mechanism. The model registers what it doesn't know before acting.

`<unknown>which database adapter is configured</unknown>`

## Registration

- **Tool**: `unknown`
- **Category**: `unknown`
- **Handler**: None — recorded by TurnExecutor, deduplicated against existing unknowns.
- **Filter**: `assembly.system` at priority 350 — renders `<unknowns>` at the bottom of the system message (after `<summary>` 200, `<visible>` 250, `<log>` 300). Open work surfaces alongside the rest of the accumulated state in system; the user message holds prompt + budget + per-turn requirements.

## Projection

`# unknown\n{body}`

## Behavior

Unknowns are sticky — they persist across turns until the model explicitly
removes them with `<rm>`. The model investigates unknowns using `<get>`,
`<env>`, or `<ask_user>`, then removes resolved ones. Server deduplicates
on insert. Each unknown renders with turn, visibility, and tokens for
temporal reasoning and context management.

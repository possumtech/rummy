# skill {#skill_plugin}

Drop-in deep skills: a single markdown file, a folder of markdown files,
or a `.zip` archive — local or URL — archived under `skill://<name>/...`
for the run.

**Host-mediated, not model-facing.** Clients invoke `skill` via the RPC
tool fallback (`{ run, path }`). The handler runs through the same
`hooks.tools.dispatch` path as model emissions but `markHidden()` keeps
the command out of `<system_commands>` — the model can't ingest a skill
by accident. Pattern parallels `store` (SPEC §store_rpc).

## Files

- **skill.js** — RPC-callable handler + `skill://` scheme registration.

## Invocation

RPC: `skill { run: "<alias>", path: "<path-or-url>" }`.

- Single `.md` file → indexed at `skill://<basename>`.
- Folder → walk `*.md`; index file (`index.md`) → `skill://<foldername>`
  (indexed); rest → `skill://<foldername>/<relpath-without-.md>`
  (archived). `index.md` segments collapse: `foo/index.md` becomes
  `skill://<foldername>/foo`.
- `.zip` → unpack `*.md`; same layout as folder. Top-level archive
  folder is stripped (`example/index.md` inside `example.zip` ↦
  `skill://example`).
- URL → fetch. `.zip` extension or `Content-Type: application/zip`
  triggers zip unpack; otherwise treated as a single markdown file.

Relative paths resolve against the project root. Absolute paths used
as-is.

## Authoring

Skill files reference each other with absolute `skill://...` URIs:
`[next](skill://playbook/next)`. No relative-link rewriting at archive
time — the contract is explicit so navigation works the same regardless
of how the skill was packaged.

## Visibility

- Index page → `indexed` (visible to the model via `<index>` tile).
- All other pages → `archived` (out of context until promoted).

## Re-emit

Re-invoking with the same path overwrites prior entries — source may
have changed mid-run.

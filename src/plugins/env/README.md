# env {#env_plugin}

Runs an exploratory shell command and records the output. Streaming
producer — same entry shape as [sh](../sh/README.md), different scheme
name so ask-mode policy can admit read-only discovery without allowing
side effects.

## Registration

- **Tool**: `env`
- **Scheme**: `env` — `category: "data"`, `volatile: true` (channels sort
  to the bottom of `<index>` for cache stability).
- **Handler**: Upserts the proposal entry at status 202 (proposed).

## Two namespaces per invocation

- **Log entry**: `log://<L>/<T>/<S>/env` — scheme=`log`,
  category=`logging`. The audit record (renders as a slim recap in
  `<log>`).
- **Data channels**: `env://<L>/<T>/<S>_1` (stdout),
  `env://<L>/<T>/<S>_2` (stderr) — scheme=`env`, volatile data.
  Render in `<index>` at the bottom (volatile-sorted) with a tail
  preview; full body via `<get>`.

The `env` scheme exists **only** for the data channels. See
[scheme_category_split](SPEC.md#scheme_category_split).

## Projection

- Log entry view: slim recap.
- Data channel view: tail preview via `streamSummary`.

# sh {#sh_plugin}

Proposes shell command execution for client approval. Streaming
producer: the actual stdout/stderr arrive as separate data entries
after the proposal is accepted.

## Registration

- **Tool**: `sh`
- **Scheme**: `sh` — `category: "data"`, `volatile: true` (channels sort
  to the bottom of `<index>` for cache stability).
- **Handler**: Upserts the proposal entry at status 202 (proposed). The
  client must approve execution.

## Two namespaces per invocation

A single `<sh>` emission produces entries in two namespaces — one audit
record, one data payload:

- **Log entry**: `log://<L>/<T>/<S>/sh` — scheme=`log`,
  category=`logging`. This is the proposal the client sees and
  resolves. On accept, body is rewritten to `ran '{cmd}' (in
  progress). Output: {dataBase}_1, {dataBase}_2` and finalized by
  `stream/completed` with exit code + duration. Renders as a slim
  recap inside `<log>`.
- **Data channels**: `sh://<L>/<T>/<S>_1` (stdout),
  `sh://<L>/<T>/<S>_2` (stderr) — scheme=`sh`, volatile data.
  Created at status=102 on proposal acceptance, grow via the `stream`
  RPC, transition to 200/500 via `stream/completed`. Render in
  `<index>` at the bottom (volatile-sorted) with a tail preview;
  full body via `<get>`.

The `sh` scheme exists **only** for the data channels. The proposal/log
entry itself is in the unified `log://` namespace along with every
other action record. See [scheme_category_split](SPEC.md#scheme_category_split).

## Projection

- Log entry view: slim recap (`<sh>` envelope with command + exit code).
- Data channel view: tail preview via `streamSummary` (last N lines).
  Full body retrievable with `<get path="sh://..." line="-50" limit="50"/>`.

## Behavior

All shell commands require client-side approval — nothing executes
server-side. Act mode only; excluded in ask mode by `resolveForLoop`.

# error {#error_plugin}

Subscribes to the `error.log` hook and writes errors via the
universal log channel at `log://<L>/<T>/<S>/error`. Also owns
cycle-detection via the `turn.verdict` filter chain.

## Registration

- **Scheme**: `error` (`category: "logging"`). The namespace
  exists as an extension surface for future error-channel
  plugins; today's core writes errors at
  `log://<L>/<T>/<S>/error` (action segment="error") rather than
  to bare `error://` paths.
- **View** — registered under the plugin name (`error`) so
  `log://.../error` entries route to this plugin's projection.
- **Hook subscriber** — `error.log` writes the entry, sets
  `state: "failed"`, `outcome: "status:<N>"` (or `null` for soft
  errors), and increments the turn-error counter on hard failures.
- **Filter** — `turn.verdict` returns `{ continue, status, reason }`
  consulting cycle detection and strike streak.

## Projection

`view(entry)` returns `entry.body` verbatim. The body is the
human-readable error message; structured fields (status code,
archive counts on 413, etc.) live on `attrs`.

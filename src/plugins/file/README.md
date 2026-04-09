# file

Owns file-related projections and file constraint management.

## Registration

- **Schemes**: `file` (bare paths), `http`, `https` — all `category: "data"`
- **Views**: `full` and `summary` for file scheme. Default identity views
  for `http`/`https` (overridden by rummy.web when installed).
- **No tool handler** — file operations are dispatched through `set`, `get`, `rm`, etc.

## File Constraints

Static methods `setConstraint` and `dropConstraint` manage per-project
file constraints in the database. Constraints are project-level config
(backbone), not tool dispatch. See SPEC.md §2.3.

- `active` / `readonly` — promoted into context.
- `ignore` — excluded from scans; demotes existing entries.

Entry promotion/demotion from constraints goes through the standard
tool handler chain via `dispatchTool`.

# Folksonomic XML Command Definitions: [%TOOLS%]

YOU MUST ONLY use the available Folksonomic XML Commands.

YOU MUST NOT use shell commands for entry file operations. Entry files require XML Commands.
Example: <get path="src/*.txt" manifest/>
Example:
	<set path="file_on_disk.txt" tags="searchable,tags,internal,useful"><<NEW
	Entries without a scheme prefix are files.
	NEW</set>

* Files, entries, prompts, and log events are all accessible with the XML Commands.
* Entries without a scheme (`{scheme}://`) are files; with a scheme are not.

## Packet Layout

* `<index>` — catalog of indexed entries. Knowns/unknowns/files/streams/prompts as tiles. Stable schemes first; volatile (sh/env streams) last for cache.
* `<log>` — time-ordered activity tape. Action recaps, errors, retrievals, prompts. Active task = the last `<log>` entry.
* `<turn>` — per-turn meta: commands list, mode warn, archived count from prior 413, tokenUsage / tokensFree headlines, per-scheme breakdown table.

## Core XML Command Grammar

<{set|get|mv|cp|rm} path="{path}" {archive|index} tags="{tags}" {manifest}>{body}</{set|get|mv|cp|rm}>

### path: Unified address scheme for memory entries, log entries, prompts, and project files

* Paths without a `scheme://` are file system relative paths
* Accessing and modifying entries is unified for memory entries, log entries, prompts, and project files
* Accepts patterns (glob, regex, jsonpath, xpath) for search and bulk operations

### archive / index: Two-state catalog visibility

* indexed: Entry appears in `<index>` as a tile. Knowns and unknowns show their full body in the tile; files (default) and streams show partial; full body via `<get>`.
* archived: Entry hidden from `<index>`, recallable later by path or pattern.

* `<set path="..." archive/>` — archive an entry (no body required).
* `<set path="..." index/>` — restore an archived entry to the index.
* `<get path="...">` — fetch the full body into `<log>`. Greedy: also re-indexes the entry if archived.

### tags: Enhance your memory with folksonomic tagging of entries

* The `set` command's "tags" attribute sets tags. The other Core XML Commands filter by tags.

### manifest

* Adding the manifest attribute only returns a list of paths (and their token count) that would match the command.

### body

* Whether the command's tag body is optional and what it is for depends on the specific Core XML Command.
* `<set>` always echoes its body verbatim into `<log>` so you can see exactly what you wrote.
* `<get>` brings the retrieved content into `<log>` as the body.
* Most other action recaps (sh/env/mv/cp/rm/ask_user) carry no body — just JSON metadata.

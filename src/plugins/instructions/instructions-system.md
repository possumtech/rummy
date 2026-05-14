# Folksonomic XML Command Definitions: [%TOOLS%]

YOU MUST ONLY use the available Folksonomic XML Commands.

* Files, entries, prompts, and log events are all accessible with the Folksonomic XML Commands.

YOU MUST NOT use shell commands for standard entry file operations. Entry files require Folksonomic XML Commands.
Example: <get path="src/*.txt" manifest/>
Example:
	<set path="file_on_disk.txt" tags="searchable,tags,internal,useful"><<NEW
	Entries without a scheme (`{scheme}://`) are the relative paths of project files.
	NEW</set>

## Core Folksonomic System Architecture

* index — Partial (indexed) list of entries in the Extended Context
* archive (hidden) — Entries in the Extended Context that aren't currently indexed (recallable by path or pattern)
* repo://manifest - Complete list of all archived and indexed entries

* log — Chronicle of commands and events in the current run
* prompt — Current user prompt
* turn — System information about the current turn

* `<set path="..." archive/>` — archive an entry (reversible)
* `<set path="..." index/>` — restore an archived entry to the index
* `<get path="...">` — fetch the full body into `<log>`

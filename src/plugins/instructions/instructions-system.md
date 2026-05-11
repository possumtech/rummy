# Folksonomic XML Command Definitions: [%TOOLS%]

YOU MUST ONLY use the available Folksonomic XML Commands.

* Files, entries, prompts, and log events are all accessible with the Folksonomic XML Commands.

YOU MUST NOT use shell commands for entry file operations. Entry files require Folksonomic XML Commands.
Example: <get path="src/*.txt" manifest/>
Example:
	<set path="file_on_disk.txt" tags="searchable,tags,internal,useful"><<NEW
	Entries without a scheme (`{scheme}://`) are the relative paths of project files; entries with a scheme exist in your Extended Context
	NEW</set>

## Core Folksonomic System Architecture

* index - Partial (indexed) list of entries in the Extended Context
* archive - Entries in the Extended Context that aren't currently indexed (recallable by path or pattern)

* log - Chronicle of commands and events in the current run
* prompt - Current user prompt
* turn - System information about the current turn

* `<set path="..." archive/>` — archive an entry
* `<set path="..." index/>` — restore an archived entry to the index
* `<get path="...">` — fetch the full body into `<log>`

YOU MUST index and archive files, entries, prompts, and log events as necessary to manage your Active Context.
YOU MUST optimize your Active Context for focusing and reasoning about the current user prompt.
YOU MUST maximize relevant information and minimize irrelevant information in the Active Context.
YOU MUST avoid token budget overflow errors by never retrieving more tokens than are free.

## Core Folksonomic XML Command Grammar

<{set|get|mv|cp|rm} path="{path}" tags="{tags}" {archive|index} {manifest}>{body}</{set|get|mv|cp|rm}>

### path: Unified address scheme for memory entries, log entries, prompts, and project files

* Accessing and modifying entries is unified for memory entries, log entries, prompts, and project files
* Accepts patterns (glob, regex, jsonpath, xpath) for search and bulk operations

### tags: Enhance your memory with folksonomic tagging of entries

* The `set` command's "tags" attribute sets folksonomic tags. The other Core Folksonomic XML Commands filter by tags.

### {archive|index}

* The `set` command's `archive` and `index` attributes enable you to manage your index and log.

### manifest

* Adding the manifest attribute returns a list of paths (and their token count) that would match the command instead of executing the command.

### body

* See the specific command definition to determine what the command's body does, if anything.

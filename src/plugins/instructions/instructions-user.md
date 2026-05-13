# Folksonomic XML Command Requirements

## Core Folksonomic XML Command Grammar

<{set|get|mv|cp|rm} path="{path}" tags="{tags}" {manifest}>{body}</{set|get|mv|cp|rm}>

### path: Unified address scheme for memory entries, log entries, prompts, and project files

* Accessing and modifying entries is unified for memory entries, log entries, prompts, and project files.
* Accepts patterns (glob, regex, jsonpath, xpath) for search and bulk operations.

### tags: Enhance your memory with folksonomic tagging of entries

* The `set` command's "tags" attribute sets folksonomic tags. The other Core Folksonomic XML Commands filter by tags.

### {archive|index}

* The `set` command's `archive` and `index` attributes enable you to manage your index and log.

### manifest

* Adding the manifest attribute returns a list of paths (and their token count) that would match the command instead of executing the command.

### body

* See the specific command definition to determine what the command's body does, if anything.

## Folksonomic XML Command Rules

YOU MUST ONLY populate known entries with linked source entry information, NOT from index summaries, symbols, snippets, or model training.
YOU MUST archive newly distilled and/or irrelevant log, file, and other entries every turn to optimize context, maximize relevance, and increase `tokensFree`.
YOU MUST adapt, edit, update, and revise the `known://plan` to align with the prompt and your progress every turn.
YOU MUST terminate every turn with <update status="{102|200}">{ direct one-line answer or one-line summary }</update> (<= 80 chars).

## <set path="{path}" tags="{topical,searchable,folksonomic,internal,tags}" {archive|index} {manifest}>[Operative Label Edit]</set> - Create, edit, or update an entry

YOU SHOULD prefer minimal and multiple atomic edits to reduce the frequency and severity of conflicts and errors

* `archive`: demote an entry from `<index>`.
* `index`: promote an archived entry to `<index>`.
* archive/index are mutually exclusive on the same `<set>`.

* The <set/> command's entry edit functionality requires matching HEREDOC string literal syntax

* Operative Labels: ({SEARCH|REPLACE|NEW|PREPEND|APPEND|DELETE}) dictate the type of edit
	SEARCH/REPLACE - SEARCH/REPLACE string literal syntax uses HEREDOC in place of git conflict markers
	SEARCH[LineFirst-LineFinal]/REPLACE - Replace by line number range instead of matching literal text
	NEW - Create (or clobber) entry content
	PREPEND - Prepend content at beginning of existing entry
	APPEND - Append content to end of existing entry
	DELETE - Delete matching content in existing entry

Example:
	<set path="src/main.go"><<SEARCH
	exact
	text
	to be
	replaced
	SEARCH<<REPLACE
	new
	replacement
	text
	REPLACE</set>

Example:
	<set path="src/main.go"><<SEARCH[12-14]SEARCH[12-14]<<REPLACE
	Match and
	replace lines
	12 through 14
	with literal text
	REPLACE</set>

Example:
	<set path="src/main.go" tags="go,source,unlinted" index><<NEW
	package main
	
	func main() {}
	NEW</set>

Example:
	<set path="known://plan" tags="docs"><<PREPEND0
	Documenting the <<PREPEND label
	PREPEND0</set>

Example:
	<set path="known://plan" tags="plan,project,todo"><<APPEND
	- [ ] new task
	APPEND</set>

Example:
	<set path="src/main.go"><<DELETE
	deprecated_function()
	DELETE</set>

Example:
	<set path="docs/guide.md" tags="docs" archive><<GUIDE
	The pair is <<SEARCH ... SEARCH<<REPLACE ... REPLACE.
	GUIDE</set>

Example:
	<set path="trivia/capitals.csv" archive/>
	<set path="known://plans/irrelevant_entry" archive/>
	<set path="known://plans/relevant_entry" index/>

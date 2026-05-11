## <set path="{path}" tags="{topical,searchable,folksonomic,internal,tags}" {archive|index} {manifest}>{edit(s)}</set> - Create, edit, or update an entry

YOU SHOULD prefer minimal and multiple atomic edits to reduce the frequency and severity of conflicts and errors.
YOU MAY add alphanumeric suffixes to the matching Operative Labels to ensure uniqueness.
YOU SHOULD ensure that you have enough `tokensFree` space available before writing large entries.

* `archive`: demote an entry from `<index>`.
* `index`: promote an archived entry to `<index>`.
* archive/index are mutually exclusive on the same `<set>`.
* When copying from log entries, remember that the line numbers and tab are not part of the source document

* The <set/> command's entry edit functionality requires matching HEREDOC string literal syntax.

* Operative Labels: ({SEARCH/REPLACE}|NEW|PREPEND|APPEND|DELETE) dictate the type of edit.
	<<SEARCH[LineFirst]SEARCH[LineFinal]<<REPLACE{replacement literal text}REPLACE — Replace line number range with literal text
	<<SEARCH{match exact, literal line(s) of text to entirely replace}SEARCH<<REPLACE{replacement text}REPLACE — Replace matching text
	<<NEW{new literal text}NEW — Create (or clobber) entry content
	<<PREPEND{new literal text}PREPEND — Prepend content at beginning of existing entry
	<<APPEND{new literal text}APPEND — Append content to end of existing entry
	<<DELETE{match}DELETE — Delete matching content in existing entry

Example:
	<set path="src/main.go"><<SEARCH[12]SEARCH[14]<<REPLACE
	Match and
	replace lines
	12 through 14
	with literal text
	REPLACE</set>

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
	<set path="src/main.go" tags="go,source,unlinted" index><<NEW
	package main
	
	func main() {}
	NEW</set>

Example:
	<set path="known://plan" tags="plan,project,todo">
	
	<<PREPEND0
	- [ ] Document the <<PREPEND label
	PREPEND0
	
	<<APPEND
	- [ ] new task
	APPEND

	</set>

Example:
	<set path="src/main.go"><<DELETE
	deprecated_function()
	DELETE</set>

Example:
	<set path="trivia/capitals.csv" archive/>
	<set path="known://plans/irrelevant_entry" archive/>
	<set path="known://plans/relevant_entry" index/>

Example:
	<set path="known://plans/*" manifest/>

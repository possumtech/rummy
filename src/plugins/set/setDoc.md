## <set path="{path}" tags="{topical,searchable,folksonomic,internal,tags}">[content or edit]</set> - Create, edit, or update an entry or file

YOU SHOULD prefer minimal and multiple atomic edits to reduce the frequency and severity of conflicts and errors

* The <set/> command requires matching HEREDOC label string literal syntax

* Special Operative Labels: ({SEARCH|REPLACE|NEW|PREPEND|APPEND|DELETE}) dictate the type of edit
	SEARCH/REPLACE - SEARCH/REPLACE string literal syntax uses HEREDOC in place of git conflict markers
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
	<set path="src/main.go" tags="go,source,unlinted"><<NEW
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
<!-- DELETE: remove a literal-matching region. -->

Example:
	<set path="docs/guide.md" tags="docs"><<GUIDE
	The pair is <<SEARCH ... SEARCH<<REPLACE ... REPLACE.
	GUIDE</set>

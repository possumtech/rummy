## <set path="{path}" tags="{tags}" {archive|index} {manifest}>{udiff}</set> - Create, edit, or update an entry

YOU MUST emit a unified diff. One or more `@@` hunks with `-`/`+`/` `-prefixed lines.
YOU SHOULD prefer minimal atomic edits.

* `archive`/`index`: visibility flip (mutually exclusive).

Example — edit:
	<set path="src/config.json">@@ -3,1 +3,1 @@
	-  "port": 3000,
	+  "port": 8080,
	</set>

Example — create (pure-insert from empty):
	<set path="src/main.go" tags="go" index>@@ -0,0 +1,3 @@
	+package main
	+
	+func main() {}
	</set>

Example — multi-hunk (each `@@` independent, applied in order):
	<set path="known://plan">@@ -1,1 +1,2 @@
	-- [ ] Draft
	+- [x] Draft
	+- [ ] Decompose
	@@ -5,1 +6,1 @@
	-- [ ] Deliver
	+- [x] Deliver
	</set>

Example — delete-only (no `+` lines):
	<set path="src/main.go">@@ -42,1 +42,0 @@
	-deprecated_function()
	</set>

Example — visibility flip (no body):
	<set path="trivia/capitals.csv" archive/>

Example — manifest (list matches without writing):
	<set path="known://plans/*" manifest/>

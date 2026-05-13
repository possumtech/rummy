## <set path="{path}" tags="{tags}" {archive|index} {manifest}>{udiff}</set> - Create, edit, or update an entry

YOU MUST emit a unified diff. One or more `@@` hunks with `-`/`+`/` `-prefixed lines.
YOU SHOULD confirm the state of stale entries with `<get/>` before editing, not your assumption or guess.
YOU SHOULD prefer minimal, atomic edits.

* `archive`/`index`: visibility flip (mutually exclusive).

Example — multi-hunk edit:
	<set path="known://countries/france/capital" tags="">@@ -4,1 +4,1 @@
	-The capital of France is Paris, on the river Seine in north-central France.
	+The capital of France is Paris, on the river Seine in north-central France. Paris has been the continuous capital of France since 987 CE.
	@@ -4,0 +5,5 @@
	+
    +## References
	+[RESOLVES](unknown://countries/france/capital).
	+[Wikipedia: Paris](https://en.wikipedia.org/wiki/Paris)
	+[Wikipedia: History of Paris](https://en.wikipedia.org/wiki/History_of_Paris)
	</set>

Example — mark a plan step complete:
	<set path="known://plan">@@ -1,1 +1,1 @@
	-- [ ] Decompose the trivia question into unknown entries
	+- [x] Decompose the trivia question into unknown entries
	</set>

Example — remove a log, file, or other entry from the index:
	<set path="trivia/capitals.csv" archive/>

Example — add an archived log, file, or other entry to the index:
	<set path="trivia/capitals.csv" index/>

Example — manifest (list matches without writing):
	<set path="known://countries/*" manifest/>

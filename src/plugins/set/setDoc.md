## <set path="{path}" tags="{tags}" {archive|index} {manifest}>{udiff}</set> - Create, edit, or update an entry

YOU MUST emit a unified diff. One or more `@@` hunks with `-`/`+`/` `-prefixed lines.
YOU SHOULD confirm the state of stale entries with `<get/>` before editing, not your assumption or guess.
YOU SHOULD prefer minimal, atomic edits.

* `archive`/`index`: visibility flip (mutually exclusive).

Example — initial creates (pure-insert hunks against an empty body):
	<set path="known://plan">@@ -0,0 +1,6 @@
	+- [ ] Decompose the prompt into unknown entries
	+- [ ] Discover information for each unknown
	+- [ ] Distill discoveries into known entries
	+- [ ] Define the answer
	+- [ ] Determine accuracy
	+- [ ] Deliver
	</set>

	<set path="unknown://countries/france/capital" tags="france,geography,trivia">@@ -0,0 +1,1 @@
	+What is the capital of France?
	</set>

Example — multi-hunk edit (mark complete + expand with a reference; hunks apply in order, line numbers reference the body that resulted from prior hunks):
	<set path="known://plan">@@ -1,1 +1,1 @@
	-- [ ] Decompose the prompt into unknown entries
	+- [x] Decompose the prompt into unknown entries
	@@ -2,1 +2,2 @@
	-- [ ] Discover information for each unknown
	+- [x] Discover information for each unknown
	+  - https://en.wikipedia.org/wiki/Paris
	</set>

Example — remove a log, file, or other entry from the index:
	<set path="trivia/capitals.csv" archive/>

Example — add an archived log, file, or other entry to the index:
	<set path="trivia/capitals.csv" index/>

Example — manifest (list matches without writing):
	<set path="known://plans/*" manifest/>

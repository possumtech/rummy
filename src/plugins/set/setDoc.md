## <set path="{path}" tags="{tags}" {archive|index} {manifest}>{Heredoc Operation}</set> - Create, edit, or update an entry

Heredoc Operations:
* `<<NEW ... NEW` — create or overwrite entire body.
* `<<APPEND ... APPEND` — append content to the end.
* `<<PREPEND ... PREPEND` — prepend content to the start.
* `<<REPLACE[N] ... REPLACE[M]` — replace lines N through M (line numbers only, NO text matching)
* `<<DELETE[N] ... DELETE[M]` — delete lines N through M (empty body, line numbers only, NO text matching).

* `archive` archives the entry, optimizing context relevance and freeing `tokensFree`.
* `index` restores an entry from the archive, consuming `tokens="N"` tokens.

YOU SHOULD prefer minimal, atomic edits.
YOU MAY append alphanumeric characters after the Heredoc Operations label to ensure uniqueness.

Example: <set path="known://plan"><<REPLACE[1]- [x] Decompose the trivia question into unknown entries REPLACE[1]</set>

Example:
	<set path="known://countries/france/capital"><<REPLACE[4]
	The capital of France is Paris, on the river Seine in north-central France. Paris has been the continuous capital of France since 987 CE.
	
	## References
	[RESOLVES](unknown://countries/france/capital).
	[Wikipedia: Paris](https://en.wikipedia.org/wiki/Paris)
	[Wikipedia: History of Paris](https://en.wikipedia.org/wiki/History_of_Paris)
	REPLACE[4]</set>

Example — create a new entry:
	<set path="unknown://countries/france/capital" tags="france,geography,trivia"><<NEW What is the capital of France? NEW</set>

Example: <set path="known://plan"><<DELETE[3]DELETE[5]</set>

Example: <set path="trivia/capitals.csv" archive/>
Example: <set path="trivia/capitals.csv" index/>

Example: <set path="known://countries/*" manifest/>

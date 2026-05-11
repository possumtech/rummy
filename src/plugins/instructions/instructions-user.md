# Folksonomic XML Command Requirements

YOU MUST ONLY populate known entries with linked source entry information, NOT from index summaries, symbols, snippets, or model training.

Example:
	<get path="**" manifest>capital</get>
	<get path="prompt://3" line="1" limit="100"/>

	<get path="trivia/capitals.csv"/>

	<set path="known://trivia/geography/capitals" tags="countries,france,capital,geography,trivia"><<NEW
	# Related
	[trivia question](prompt://3)
	[unknown resolving](unknown://countries/france/capital)
	[source entry](trivia/capitals.csv)

	{ relevant information derived from the linked source entry brought into <log> }
	NEW</set>

	<set path="known://plan"><<SEARCH
	- [ ] Discover key, relevant information
	SEARCH<<REPLACE
	- [ ] Discover key, relevant information about French capital
	   - [ ] Locate authoritative capital source
	   - [ ] Cross-check with secondary source
	REPLACE</set>

	<set path="unknown://countries/france/capital" tags="RESOLVED" archive/>
	<set path="trivia/capitals.csv" archive/>
	{ archiving entries the next turn won't need; rm those that definitely won't matter }

	<set path="known://plan"><<SEARCH - [ ] Find the capital of France SEARCH<<REPLACE - [x] Find the capital of France REPLACE</set>
	<update status="102">distilled the capital of France into known entry; archived the source</update>

Example:
	<set path="known://plan"><<SEARCH
	- [ ] Deliver answer to trivia question
	SEARCH<<REPLACE
	- [x] Deliver answer to trivia question
	REPLACE</set>
	<update status="200">Paris</update>

YOU MUST terminate every turn with <update status="{102|200}">{ direct one-line answer or one-line summary }</update> (<= 80 chars).

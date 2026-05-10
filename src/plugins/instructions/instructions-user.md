# Folksonomic XML Command Instructions

YOU MUST ensure that all unknowns have been RESOLVED (with known entry references) or REJECTED before delivering.
YOU MUST distill unknowns into key, relevant knowns that are topical, taxonomized, tagged, and referenced.
YOU MUST ONLY populate known entries with linked source entry information you brought into `<log>` via `<get>`, NOT from index tiles or model training.
YOU SHOULD archive entries you no longer need so they don't crowd the index.

* The `"tokens":N` field shows how much context an entry consumes when its full body is in `<log>`. Index tiles cost ≤500 chars regardless.
* Use `<get path="..." manifest/>` to list paths and their token amounts for bulk operations.
* Use `<get tags="..." manifest/>` to recall entries by tags when paths are forgotten.
* Use `<get path="..." line="X" limit="Y"/>` to read subsets of entries that would exceed your `tokensFree` budget.

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

YOU MUST NOT allow the `"tokens":N` sum of entries brought into `<log>` to exceed `tokensFree="N"` budget.
YOU MUST terminate every turn with <update status="{102|200}">{ direct one-line answer or one-line summary }</update> (<= 80 chars)

## <update status="N">{ direct one-line answer or one-line summary }</update> - Turn termination

YOU MUST conclude every turn with one (and only one) <update status="N"></update>.
YOU MUST keep the update body to <= 80 characters.
YOU MUST use status 102 for continuation and 200 for final delivery.

Example:
	<set path="unknown://countries/france/capital" tags="france,geography,trivia"><<NEW
	What is the capital of France?
	NEW</set>
	
	<set path="unknown://countries/france/population" tags="france,geography,trivia"><<NEW
	What is the population of France?
	NEW</set>
	
	<set path="known://plan"><<NEW
	- [ ] Decompose the prompt into unknowns
	- [ ] Discover capital of France
	- [ ] Discover population of France
	- [ ] Deliver
	NEW</set>
	
	<update status="102">decomposed; plan initialized</update>

Example:
	<get path="https://en.wikipedia.org/wiki/Paris" lineFirst="542" lineFinal="767"/>
	<set path="known://countries/france/capital" tags="france,geography,capitals,europe"><<NEW
	# Capital of France
	
	The capital of France is Paris, on the river Seine. Paris has been the continuous capital since 987 CE.
	
	## References
	[RESOLVES](unknown://countries/france/capital).
	[Wikipedia: Paris](https://en.wikipedia.org/wiki/Paris)
	NEW</set>
	
	<set path="https://www.britannica.com/biography/Paris" archive/>
	<set path="log://1/4/1/get" archive/>
	<set path="log://1/4/2/get" archive/>
	{ ...archive all distilled or irrelevant log or index entries }
	
	<set path="known://plan"><<REPLACE[3]
	- [x] Distill geography unknowns
	REPLACE[3]</set>
	
	<update status="102">read Paris 542-767; distilled capital; archived stale fetches; advanced plan</update>

Example:
	<set path="known://plan"><<REPLACE[7]- [x] Deliver direct answer to trivia question REPLACE[7]</set>
	
	<update status="200">Paris</update>

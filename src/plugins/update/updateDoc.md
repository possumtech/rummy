## <update status="N">{ direct one-line answer or one-line summary }</update> - Turn termination

YOU MUST conclude every turn with one (and only one) <update status="N"></update>.
YOU MUST keep the update body to <= 80 characters.
YOU MUST use status 102 for continuation and 200 for final delivery.

Example — bundle archives, a get, a plan edit, and the terminator in one turn:
	<set path="log://1/3/1/get" archive/>
	<set path="log://1/4/2/get" archive/>
	<get path="known://research/source.md" lineFirst="542" lineFinal="767"/>
	<set path="known://plan">@@ -3,1 +3,1 @@
	-- [ ] Distill geography unknowns
	+- [x] Distill geography unknowns
	</set>
	<update status="102">archived prior chunks; fetched government section; distilled geography</update>

Example:
	<set path="known://plan">@@ -7,1 +7,1 @@
	-- [ ] Deliver direct answer to trivia question
	+- [x] Deliver direct answer to trivia question
	</set>
	<update status="200">Paris</update>

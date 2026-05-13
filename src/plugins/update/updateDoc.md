## <update status="N">{ direct one-line answer or one-line summary }</update> - Turn termination

YOU MUST conclude every turn with one (and only one) <update status="N"></update>.
YOU MUST keep the update body to <= 80 characters.
YOU MUST use status 102 for continuation and 200 for final delivery.

Example:
	{ demote irrelevant source entries and log entries }
	<set path="known://plan">@@ -3,1 +3,1 @@
	-- [ ] Distill geography unknowns
	+- [x] Distill geography unknowns
	</set>
	<update status="102">distilled three unknowns into known://trivia/geography/capitals</update>
Example:
	<set path="known://plan">@@ -7,1 +7,1 @@
	-- [ ] Deliver direct answer
	+- [x] Deliver direct answer
	</set>
	<update status="200">Paris</update>

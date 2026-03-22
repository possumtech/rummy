-- PREP: get_ranked_repo_map
SELECT
	id
	, path
	, size
	, hash
	, visibility
	, symbol_tokens
	, is_active
	, is_retained
	, is_buffered
	, heat
	, last_attention_turn
FROM repo_map_ranked
WHERE project_id = :project_id
ORDER BY is_active DESC, heat DESC;

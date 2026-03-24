-- PREP: get_ranked_repo_map
SELECT
	f.id
	, f.path
	, f.size
	, f.symbol_tokens
	, cp.constraint_type AS client_constraint
	, CASE WHEN ap.id IS NOT NULL THEN 1 ELSE 0 END AS has_agent_promotion
	, ap.last_attention_turn
	, CASE WHEN ep.id IS NOT NULL THEN 1 ELSE 0 END AS has_editor_promotion
	, EXISTS(SELECT 1 FROM file_promotions WHERE file_id = f.id) AS is_promoted
	, (
		SELECT COUNT(*)
		FROM repo_map_references AS r
		JOIN repo_map_tags AS t ON r.symbol_name = t.name
		JOIN repo_map_files AS f2 ON r.file_id = f2.id
		JOIN file_promotions AS fp ON f2.id = fp.file_id
		WHERE
			t.file_id = f.id
			AND f2.id != f.id
	) * 2 + f.is_root AS heat
FROM repo_map_files AS f
LEFT JOIN file_promotions AS cp ON f.id = cp.file_id AND cp.source = 'client'
LEFT JOIN file_promotions AS ap ON f.id = ap.file_id AND ap.source = 'agent'
LEFT JOIN file_promotions AS ep ON f.id = ep.file_id AND ep.source = 'editor'
WHERE f.project_id = :project_id
ORDER BY
	is_promoted DESC
	, heat DESC
	, f.path ASC;

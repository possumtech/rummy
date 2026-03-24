-- PREP: get_project_repo_map
SELECT
	f.id
	, f.path
	, f.size
	, f.hash
	, f.symbol_tokens
	, cp.constraint_type AS client_constraint
	, CASE WHEN ap.id IS NOT NULL THEN 1 ELSE 0 END AS has_agent_promotion
	, CASE WHEN ep.id IS NOT NULL THEN 1 ELSE 0 END AS has_editor_promotion
	, t.name
	, t.type
	, t.params
	, t.line
	, t.source
FROM repo_map_files AS f
LEFT JOIN file_promotions AS cp ON f.id = cp.file_id AND cp.source = 'client'
LEFT JOIN file_promotions AS ap ON f.id = ap.file_id AND ap.source = 'agent'
LEFT JOIN file_promotions AS ep ON f.id = ep.file_id AND ep.source = 'editor'
LEFT JOIN repo_map_tags AS t ON f.id = t.file_id
WHERE f.project_id = :project_id;

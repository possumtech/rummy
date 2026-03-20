-- PREP: get_project_repo_map
SELECT
	f.id
	, f.path
	, f.size
	, f.hash
	, f.visibility
	, f.symbol_tokens
	, f.is_buffered
	, f.is_retained
	, f.is_active
	, t.name
	, t.type
	, t.params
	, t.line
	, t.source
FROM repo_map_files AS f
LEFT JOIN repo_map_tags AS t
	ON f.id = t.file_id
WHERE f.project_id = :project_id;

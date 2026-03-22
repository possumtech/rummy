-- PREP: get_repo_map_file
SELECT
	id
	, hash
	, size
	, visibility
	, symbol_tokens
	, is_buffered
	, is_retained
	, last_indexed_at
FROM repo_map_files
WHERE
	project_id = :project_id
	AND path = :path;

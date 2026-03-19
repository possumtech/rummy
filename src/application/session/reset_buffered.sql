-- PREP: reset_buffered
UPDATE repo_map_files
SET is_buffered = 0
WHERE project_id = :project_id;

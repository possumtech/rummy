-- PREP: set_buffered
UPDATE repo_map_files
SET is_buffered = 1
WHERE project_id = :project_id AND path = :path;

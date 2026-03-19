-- PREP: set_retained
UPDATE repo_map_files
SET is_retained = :is_retained
WHERE project_id = :project_id AND path = :path;

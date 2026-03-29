-- PREP: get_run_log
SELECT tool, target, status, key, '' AS value
FROM run_log
WHERE run_id = :run_id
ORDER BY sequence;

-- PREP: get_known_entries
SELECT key, state, value
FROM known_entries
WHERE run_id = :run_id
ORDER BY key;

-- PREP: count_unknowns
SELECT COUNT(*) AS count
FROM known_entries
WHERE
	run_id = :run_id
	AND path LIKE '/:unknown:%';

-- PREP: get_unknown_values
SELECT value
FROM known_entries
WHERE
	run_id = :run_id
	AND path LIKE '/:unknown:%';

-- PREP: get_unresolved
SELECT path, value, meta, turn
FROM known_entries
WHERE
	run_id = :run_id
	AND domain = 'result'
	AND state = 'proposed';

-- PREP: has_rejections
SELECT COUNT(*) AS count
FROM known_entries
WHERE
	run_id = :run_id
	AND domain = 'result'
	AND state = 'warn';

-- PREP: has_accepted_actions
SELECT COUNT(*) AS count
FROM known_entries
WHERE
	run_id = :run_id
	AND domain = 'result'
	AND state = 'pass'
	AND path REGEXP '^/:(edit|run|delete):';

-- PREP: get_file_entries
SELECT path, state, hash, updated_at
FROM known_entries
WHERE
	run_id = :run_id
	AND domain = 'file';

-- PREP: get_context_distribution
SELECT
	CASE
		WHEN path REGEXP '^/:(system|prompt):' THEN 'system'
		WHEN domain = 'file' AND turn > 0 AND state != 'symbols' THEN 'files'
		WHEN domain = 'file' THEN 'keys'
		WHEN domain = 'known' AND path LIKE '/:known:%' AND turn > 0 THEN 'known'
		WHEN domain = 'known' AND path LIKE '/:known:%' AND turn = 0 THEN 'keys'
		WHEN domain = 'result' AND state NOT IN ('proposed', 'info') THEN 'history'
		WHEN domain = 'known' AND path LIKE '/:unknown:%' THEN 'history'
		ELSE 'system'
	END AS bucket,
	COALESCE(SUM(tokens), 0) AS tokens,
	COUNT(*) AS entries
FROM known_entries
WHERE
	run_id = :run_id
	AND path NOT REGEXP '^/:(reasoning|user|retry):'
GROUP BY bucket
ORDER BY bucket;

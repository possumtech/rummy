-- PREP: count_unknowns
SELECT COUNT(*) AS count
FROM known_entries
WHERE
	run_id = :run_id
	AND key LIKE '/:unknown:%';

-- PREP: get_unknown_values
SELECT value
FROM known_entries
WHERE
	run_id = :run_id
	AND key LIKE '/:unknown:%';

-- PREP: get_unresolved
SELECT key, value, meta, turn
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
	AND (key LIKE '/:edit:%' OR key LIKE '/:run:%' OR key LIKE '/:delete:%');

-- PREP: get_file_entries
SELECT key, state, hash, updated_at
FROM known_entries
WHERE
	run_id = :run_id
	AND domain = 'file';

-- PREP: get_context_distribution
SELECT
	CASE
		WHEN key LIKE '/:system:%' OR key LIKE '/:prompt:%' THEN 'system'
		WHEN domain = 'file' AND turn > 0 AND state != 'symbols' THEN 'files'
		WHEN domain = 'file' THEN 'keys'
		WHEN domain = 'known' AND key LIKE '/:known:%' AND turn > 0 THEN 'known'
		WHEN domain = 'known' AND key LIKE '/:known:%' AND turn = 0 THEN 'keys'
		WHEN domain = 'result' AND state NOT IN ('proposed', 'info') THEN 'history'
		WHEN domain = 'known' AND key LIKE '/:unknown:%' THEN 'history'
		ELSE 'system'
	END AS bucket,
	COALESCE(SUM(tokens), 0) AS tokens,
	COUNT(*) AS entries
FROM known_entries
WHERE
	run_id = :run_id
	AND key NOT LIKE '/:reasoning:%'
	AND key NOT LIKE '/:user:%'
	AND key NOT LIKE '/:retry:%'
GROUP BY bucket
ORDER BY bucket;

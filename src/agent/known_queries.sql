-- PREP: get_known_entries
SELECT path, domain, state, value, turn, hash, meta
FROM known_entries
WHERE run_id = :run_id
ORDER BY path;

-- PREP: get_active_known
SELECT path, value
FROM known_entries
WHERE
	run_id = :run_id
	AND domain = 'known'
	AND path LIKE '/:known:%'
	AND turn > 0
ORDER BY path;

-- PREP: get_stored_known
SELECT path
FROM known_entries
WHERE
	run_id = :run_id
	AND domain = 'known'
	AND path LIKE '/:known:%'
	AND turn = 0
ORDER BY path;

-- PREP: get_stored_files
SELECT path
FROM known_entries
WHERE
	run_id = :run_id
	AND domain = 'file'
	AND state != 'ignore'
	AND turn = 0
	AND state != 'symbols'
ORDER BY path;

-- PREP: get_symbol_files
SELECT path, value, meta
FROM known_entries
WHERE
	run_id = :run_id
	AND domain = 'file'
	AND state = 'symbols'
ORDER BY path;

-- PREP: get_full_files
SELECT path, state, value, tokens
FROM known_entries
WHERE
	run_id = :run_id
	AND domain = 'file'
	AND state != 'ignore'
	AND state != 'symbols'
	AND turn > 0
ORDER BY path;

-- PREP: get_results
SELECT path, state, value, meta
FROM known_entries
WHERE
	run_id = :run_id
	AND domain = 'result'
	AND state != 'proposed'
	AND path NOT REGEXP '^/:(system|user|reasoning|prompt):'
ORDER BY id;

-- PREP: get_unknowns
SELECT path, value
FROM known_entries
WHERE
	run_id = :run_id
	AND path LIKE '/:unknown:%'
ORDER BY id;

-- PREP: get_latest_prompt
SELECT path, value
FROM known_entries
WHERE
	run_id = :run_id
	AND path LIKE '/:prompt:%'
ORDER BY id DESC
LIMIT 1;

-- PREP: get_turn_audit
SELECT path, domain, state, turn, value, meta
FROM known_entries
WHERE
	run_id = :run_id
	AND turn = :turn
ORDER BY id;

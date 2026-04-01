-- INIT: create_v_run_log
CREATE VIEW IF NOT EXISTS v_run_log AS
SELECT
	ke.run_id
	, ke.path
	, ke.state AS status
	, COALESCE(ke.scheme, ke.state) AS tool
	, COALESCE(
		json_extract(ke.meta, '$.command')
		, json_extract(ke.meta, '$.file')
		, json_extract(ke.meta, '$.path')
		, json_extract(ke.meta, '$.question')
		, ''
	) AS target
	, CASE
		WHEN ke.state = 'summary' THEN ke.value
		WHEN ke.scheme IN ('env', 'run', 'ask_user', 'inject') THEN ke.value
		ELSE ''
	END AS value
FROM known_entries AS ke
JOIN schemes AS s ON s.name = COALESCE(ke.scheme, 'file')
WHERE
	ke.scheme IS NOT NULL
	AND ke.state != 'proposed'
	AND s.category NOT IN ('knowledge', 'audit')
ORDER BY ke.id;

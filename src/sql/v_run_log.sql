-- INIT: create_v_run_log
CREATE VIEW IF NOT EXISTS v_run_log AS
SELECT
	ke.run_id
	, ke.path
	, ke.body
	, ke.status
	, ke.turn
	, ke.scheme AS tool
	, COALESCE(
		json_extract(ke.attributes, '$.command')
		, json_extract(ke.attributes, '$.file')
		, json_extract(ke.attributes, '$.path')
		, json_extract(ke.attributes, '$.question')
		, ''
	) AS target
FROM known_entries AS ke
JOIN schemes AS s ON s.name = ke.scheme
WHERE
	s.category IN ('logging', 'prompt')
	AND ke.status != 202
ORDER BY ke.id;

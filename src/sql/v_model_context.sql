-- INIT: create_v_model_context
CREATE VIEW IF NOT EXISTS v_model_context AS
WITH
visible AS (
	SELECT
		rv.run_id
		, rv.id
		, e.path
		, e.body
		, e.scheme
		, rv.state
		, rv.outcome
		, rv.visibility
		, rv.turn
		, rv.updated_at
		, e.attributes
		, COALESCE(s.category, 'logging') AS category
		, COALESCE(s.volatile, 0) AS volatile
		, CASE
			WHEN s.model_visible = 0 THEN NULL
			WHEN rv.visibility = 'archived' THEN NULL
			ELSE rv.visibility
		END AS effective_visibility
	FROM run_views AS rv
	JOIN entries AS e ON e.id = rv.entry_id
	JOIN schemes AS s ON s.name = COALESCE(e.scheme, 'file')
),
projected AS (
	SELECT
		run_id
		, id
		, path
		, scheme
		, state
		, outcome
		, effective_visibility AS visibility
		, turn
		, updated_at
		, attributes
		, category
		, volatile
		, body
	FROM visible
	WHERE effective_visibility IS NOT NULL
)
SELECT
	run_id
	, path
	, scheme
	, visibility
	, state
	, outcome
	, body
	, attributes
	, category
	, turn
	, ROW_NUMBER() OVER (
		PARTITION BY run_id
		ORDER BY
			-- data first (catalog), then logging, then prompt.
			CASE category
				WHEN 'data' THEN 1
				WHEN 'logging' THEN 2
				WHEN 'prompt' THEN 3
				ELSE 4
			END
			-- Within data: stable schemes first, volatile last (for cache).
			, volatile
			, scheme
			, turn
			, updated_at
			, path
	) AS ordinal
FROM projected;

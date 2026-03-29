-- PREP: get_last_turn_sequence
SELECT
	id AS last_turn_id
	, MAX(sequence) AS last_seq
FROM turns
WHERE run_id = :run_id;

-- PREP: create_empty_turn
INSERT INTO turns (
	run_id
	, sequence_number
) VALUES (
	:run_id
	, :sequence_number
) RETURNING id;

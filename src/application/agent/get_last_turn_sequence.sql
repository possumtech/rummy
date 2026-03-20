-- PREP: get_last_turn_sequence
SELECT MAX(sequence_number) as last_seq
FROM turns
WHERE run_id = :run_id;

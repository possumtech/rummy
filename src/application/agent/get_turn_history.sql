-- PREP: get_turn_history
-- Retrieves the history of user and assistant messages for a run 
-- in chronological order.
SELECT
	role,
	content
FROM v_turn_history
WHERE run_id = :run_id
ORDER BY sequence_number ASC, msg_index ASC;

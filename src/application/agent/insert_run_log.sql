-- PREP: insert_run_log
INSERT INTO run_log (run_id, turn_id, tool, target, status, key, sequence)
VALUES (:run_id, :turn_id, :tool, :target, :status, :key, :sequence);

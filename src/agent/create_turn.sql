-- PREP: create_turn
INSERT INTO turns (job_id, sequence_number, payload, usage)
VALUES (:job_id, :sequence_number, :payload, :usage);

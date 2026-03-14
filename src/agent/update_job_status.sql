-- PREP: update_job_status
UPDATE jobs
SET status = :status
WHERE id = :id;

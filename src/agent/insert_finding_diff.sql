-- PREP: insert_finding_diff
INSERT INTO findings_diffs (
	run_id
	, turn_id
	, file_path
	, patch
) VALUES (
	:run_id
	, :turn_id
	, :file_path
	, :patch
);
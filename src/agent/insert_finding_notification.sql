-- PREP: insert_finding_notification
INSERT INTO findings_notifications (
	run_id
	, turn_id
	, type
	, text
	, level
	, append
) VALUES (
	:run_id
	, :turn_id
	, :type
	, :text
	, :level
	, :append
);
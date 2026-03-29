-- PREP: upsert_known_entry
INSERT INTO known_entries (run_id, key, value, state, write_count)
VALUES (:run_id, :key, :value, :state, 1)
ON CONFLICT (run_id, key) DO UPDATE SET
	value = excluded.value
	, state = excluded.state
	, write_count = known_entries.write_count + 1
	, updated_at = CURRENT_TIMESTAMP;

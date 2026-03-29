-- PREP: upsert_known_entry
INSERT INTO known_entries (run_id, turn, key, value, domain, state, hash, meta)
VALUES (:run_id, :turn, :key, :value, :domain, :state, :hash, :meta)
ON CONFLICT (run_id, key) DO UPDATE SET
	value = excluded.value
	, state = excluded.state
	, hash = COALESCE(excluded.hash, known_entries.hash)
	, meta = COALESCE(excluded.meta, known_entries.meta)
	, turn = excluded.turn
	, write_count = known_entries.write_count + 1
	, updated_at = CURRENT_TIMESTAMP;

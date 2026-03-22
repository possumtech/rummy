-- PREP: update_turn_payload
UPDATE turns
SET payload = :payload
WHERE id = :id;

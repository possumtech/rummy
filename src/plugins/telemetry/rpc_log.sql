-- PREP: log_rpc_call
INSERT INTO rpc_log (session_id, method, rpc_id, params)
VALUES (:session_id, :method, :rpc_id, :params)
RETURNING id;

-- PREP: log_rpc_result
UPDATE rpc_log
SET result = :result
WHERE id = :id;

-- PREP: log_rpc_error
UPDATE rpc_log
SET error = :error
WHERE id = :id;

-- PREP: get_rpc_log
SELECT id, session_id, method, rpc_id, params, result, error, created_at
FROM rpc_log
WHERE session_id = :session_id
ORDER BY id DESC
LIMIT :limit;

-- PREP: get_rpc_log_by_method
SELECT id, session_id, method, rpc_id, params, result, error, created_at
FROM rpc_log
WHERE session_id = :session_id AND method = :method
ORDER BY id DESC
LIMIT :limit;

-- PREP: create_run
INSERT INTO runs (
	project_id
	, parent_run_id
	, model
	, alias
	, prompt
	, temperature
	, persona
	, context_limit
)
VALUES (
	:project_id
	, :parent_run_id
	, :model
	, :alias
	, COALESCE(:prompt, '')
	, :temperature
	, :persona
	, :context_limit
)
RETURNING id;

-- PREP: get_run_by_alias
SELECT
	id, project_id, parent_run_id, model, status, outcome, prompt, alias
	, temperature, persona, context_limit, next_turn, next_loop, created_at
FROM runs
WHERE alias = :alias;

-- PREP: get_run_by_id
SELECT
	id, project_id, parent_run_id, model, status, outcome, prompt, alias
	, temperature, persona, context_limit, next_turn, next_loop, created_at
FROM runs
WHERE id = :id;

-- PREP: get_runs_by_project
SELECT
	r.alias
	, r.status
	, r.created_at
	, r.next_turn - 1 AS turn
	, (
		SELECT ke.body
		FROM known_entries AS ke
		WHERE
			ke.run_id = r.id
			AND ke.path LIKE 'log://turn_%/update/%'
		ORDER BY ke.id DESC
		LIMIT 1
	) AS summary
FROM runs AS r
WHERE r.project_id = :project_id
ORDER BY r.created_at DESC
LIMIT
	COALESCE(:limit, -1)
	OFFSET
	COALESCE(:offset, 0);

-- PREP: get_run_summary
-- Per-run aggregation across all turns. LEFT JOIN: a run with zero
-- recorded turns (e.g. signal abort before first turn) returns 0s,
-- not NULL.
SELECT
	r.model AS model
	, COUNT(t.id) AS turns
	, COALESCE(SUM(t.cost), 0) AS cost
	, COALESCE(SUM(t.prompt_tokens), 0) AS prompt_tokens
	, COALESCE(SUM(t.cached_tokens), 0) AS cached_tokens
	, COALESCE(SUM(t.completion_tokens), 0) AS completion_tokens
	, COALESCE(SUM(t.reasoning_tokens), 0) AS reasoning_tokens
	, COALESCE(SUM(t.total_tokens), 0) AS total_tokens
FROM runs AS r
LEFT JOIN turns AS t ON t.run_id = r.id
WHERE r.id = :id
GROUP BY r.id;

-- PREP: rename_run
UPDATE runs
SET alias = :new_alias
WHERE id = :id AND alias = :old_alias;

-- PREP: update_run_status
UPDATE runs SET status = :status WHERE id = :id;

-- PREP: set_run_state
-- Run-level lifecycle write. status is required (HTTP code per state
-- machine); outcome is the failure-reason string (NULL when status
-- indicates success or non-terminal). Replaces the prior entries.set
-- on `run://<alias>` projection.
UPDATE runs
SET status = :status, outcome = :outcome
WHERE id = :id;

-- PREP: update_run_config
UPDATE runs SET
	temperature = COALESCE(:temperature, temperature)
	, persona = COALESCE(:persona, persona)
	, context_limit = COALESCE(:context_limit, context_limit)
	, model = COALESCE(:model, model)
WHERE id = :id;

-- PREP: next_turn
-- Run-absolute turn counter (used by turns.sequence and other run-level
-- accounting). Path generation uses next_loop_turn instead.
UPDATE runs
SET next_turn = next_turn + 1
WHERE id = :run_id
RETURNING next_turn - 1 AS turn;

-- PREP: next_loop_turn
-- Per-loop turn counter — increments on each new turn within a loop.
-- Resets to 1 at each new loop. Used in log://<L>/<T>/<S>/<action>.
UPDATE loops
SET next_turn = next_turn + 1
WHERE id = :loop_id
RETURNING next_turn - 1 AS turn;

-- PREP: get_loop_sequence
SELECT sequence FROM loops WHERE id = :id;

-- PREP: next_turn_seq
-- Per-turn sequence counter — increments on each new log entry within
-- a turn. Resets to 1 at each new turn. Used as S in log://<L>/<T>/<S>/<action>.
-- UPSERT: handles both the real flow (turn row created by TurnExecutor
-- before any logPath call → first call lands on ON CONFLICT, returns 1)
-- and the synthetic flow (tests that mint log paths without a turn row
-- → first call inserts with next_seq=2, returns 1). Counters stay
-- monotonic in both cases.
INSERT INTO turns (run_id, loop_id, sequence, next_seq)
VALUES (:run_id, :loop_id, :turn, 2)
ON CONFLICT (run_id, loop_id, sequence) DO UPDATE
SET next_seq = next_seq + 1
RETURNING next_seq - 1 AS seq;

-- PREP: fork_known_entries
-- Cheap fork: copy only view rows. Entries stay shared between parent
-- and child. Child's subsequent writes diverge via upsert into a new
-- run-scoped entry. Forked views inherit the parent view's loop_id —
-- the entry's prior-loop provenance carries across the fork. The
-- child's own subsequent writes update loop_id to the child's
-- current loop.
INSERT INTO run_views (
	run_id, entry_id, loop_id, turn, state, outcome, visibility
	, write_count, refs
)
SELECT
	:new_run_id, entry_id, loop_id, turn, state, outcome, visibility
	, write_count, refs
FROM run_views
WHERE run_id = :parent_run_id;

-- PREP: set_next_turn
-- Forks inherit parent's next_turn so turn numbering is absolute
-- across the lineage; the budget grinder's `current_turn - 1` rule
-- then targets parent's last-turn promotions on the fork's first
-- dispatch. See SPEC §budget_enforcement.
UPDATE runs
SET next_turn = :next_turn
WHERE id = :run_id;

-- PREP: get_active_runs
SELECT r.id
FROM runs AS r
WHERE
	r.project_id = :project_id
	AND r.status IN (100, 102, 202);

-- PREP: get_latest_run
SELECT r.id
FROM runs AS r
WHERE r.project_id = :project_id
ORDER BY r.created_at DESC
LIMIT 1;

-- PREP: get_all_runs
SELECT r.id
FROM runs AS r
WHERE r.project_id = :project_id;

-- PREP: abort_stuck_runs
UPDATE runs
SET status = 499
WHERE status IN (100, 102);

# PLAN

## Remaining

### Implementation
- [ ] **Wire `repo_map_references` population** — `insert_repo_map_ref.sql` exists but is never called. `RepoMap.updateIndex()` extracts symbols (tags) but never scans files for cross-references. Heat calculation in `get_ranked_repo_map.sql` joins `repo_map_references` but the table is always empty, so heat = `is_root` only. This is the core of ARCHITECTURE.md §2.4.

### Questions for Review
- **State table rule 6 (fallback → completed)**: Should a turn with zero tools and zero summary be allowed to complete? Currently the model can produce `<todo></todo><known>...</known><unknown></unknown>` with nothing actionable and the run completes after 3 inconsistency retries. Is this correct behavior or a bug?

## Done

### Documentation Alignment (2026-03-27)
- [x] §2.1: Documented editor promotion path→file_id resolution
- [x] §2.4: Clarified heat is dynamic/run-specific; noted vestigial view
- [x] §2.7: Documented client promotion upsert into repo_map_files for uniform ranking
- [x] §3.1: Fixed incorrect claim that RUMMY_MAP_MAX_PERCENT is unused
- [x] §3.3: Added RUMMY_RETENTION_DAYS
- [x] §4.1: Noted discover is hand-maintained
- [x] §4.2/§6.5: Documented structured feedback delivery to clients
- [x] §8: Updated retention language, added orphaned editor cleanup

### Implementation Fixes (2026-03-27)
- [x] Dropped vestigial `repo_map_ranked` view and `v_turns_summary` view from migration
- [x] Added `RUMMY_RETENTION_DAYS=31` to `.env.example`
- [x] Parameterized `purge_old_runs.sql` with `:retention_days`
- [x] `SessionManager.activate()`/`readOnly()` upsert into `repo_map_files`
- [x] Removed separate untracked-client-promo loop from `renderPerspective()`
- [x] Created `purge_orphaned_editor_promotions.sql`
- [x] Added structured `feedback` array to `Turn.toJson()` for client access

### E2E Test Hardening (2026-03-27)
- [x] Fixed diff_resolution tests: explicit prompts with SEARCH/REPLACE, 2-file partial resolution
- [x] Fixed diff_content modified test: resolve only diffs with "modified", others with "accepted"
- [x] New: prefill_workflow.test.js — verifies read→continue→prefill round-trip
- [x] New: notification_isolation.test.js — verifies session-scoped notification delivery
- [x] New: discover contract validation in rpc_surface.test.js
- [x] Command resolution tests verified passing
- [x] All 45 E2E tests pass, 161 unit tests pass, 14 integration tests pass

## Blue Skies

1. Any functionality that can rely on our hooks/filters/plugin functionality to be segregated out into a "core plugin" should be segregated into a core plugin.

2. I suspect that we're suffering from a lack of modularity, separation of concerns, single responsibility, and organization of files and folders to reflect our modularized architecture goals, resulting in context overload for both of us.

3. I suspect that our "state machine" management remains kind of hacky and would like it to be as table-driven and deterministic as possible, applying well-defined rules in a well-defined order that is well-documented, rather than a spaghetti of imperative decisions. Ideally, I would like the rest of the codebase to be at a modularity and maturity to where our key focus can be in perfecting the relationship and rules in the agent/mode interactions.

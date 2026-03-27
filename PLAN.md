# PLAN

## Remaining

### Implementation
- [ ] **Wire `repo_map_references` population** — `insert_repo_map_ref.sql` exists but is never called. `RepoMap.updateIndex()` extracts symbols (tags) but never scans files for cross-references. Heat calculation in `get_ranked_repo_map.sql` joins `repo_map_references` but the table is always empty, so heat = `is_root` only. This is the core of ARCHITECTURE.md §2.4.

### E2E Tests
- [ ] **E2E: Verify command resolution tests** — assertions updated to `level: target # message` format. Run `npm run test:e2e` and confirm the 3 command_resolution tests and 1 editor_diff_lifecycle command test pass.
- [ ] **E2E: Fix diff resolution tests** — 2 tests fail with "Model completed instead of proposing." Investigate whether the architecture allows the model to legally complete without proposing (state table rule 6 fallback). Fix either the state table or the test expectations.
- [ ] **E2E: Option D prefill workflow** — Full round-trip test: model lists read → server processes → loop continues with checked prefill → model sees file in context on second iteration.
- [ ] **E2E: Multi-client notification isolation** — Two clients on same project, verify session-scoped notification delivery.
- [ ] **E2E: Discover contract validation** — Verify every method in `discover` output actually exists and every switch case method appears in discover.

### Questions for Review
- **State table rule 6 (fallback → completed)**: Should a turn with zero tools and zero summary be allowed to complete? Currently the model can produce `<todo></todo><known>...</known><unknown></unknown>` with nothing actionable and the run completes after 3 inconsistency retries. Is this correct behavior or a bug?

## Blue Skies

1. Any functionality that can rely on our hooks/filters/plugin functionality to be segregated out into a "core plugin" should be segregated into a core plugin.

2. I suspect that we're suffering from a lack of modularity, separation of concerns, single responsibility, and organization of files and folders to reflect our modularized architecture goals, resulting in context overload for both of us.

3. I suspect that our "state machine" management remains kind of hacky and would like it to be as table-driven and deterministic as possible, applying well-defined rules in a well-defined order that is well-documented, rather than a spaghetti of imperative decisions. Ideally, I would like the rest of the codebase to be at a modularity and maturity to where our key focus can be in perfecting the relationship and rules in the agent/mode interactions.

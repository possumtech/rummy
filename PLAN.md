# PLAN

## Remaining

- [ ] **E2E: Verify command resolution tests** — assertions updated to `level: target # message` format, prompts updated to reference "env tool" not `<env>` tag. Run `npm run test:e2e` and confirm the 3 command_resolution tests and 1 editor_diff_lifecycle command test pass.
- [ ] **E2E: Fix diff resolution tests** — 2 tests fail with "Model completed instead of proposing." Investigate prompt design — the model may not reliably produce edits. Redesign tests to be deterministic.
- [ ] **E2E: Option D prefill workflow** — Write a test proving: model lists read + edit → server executes read → continuation prefill has checked read → model continues with informed edit. Key files: `AgentLoop.js:#buildPrefill`, `ToolExtractor.js`, `ResponseParser.js:mergePrefill`.
- [ ] Multi-client notification isolation testing
- [ ] Database retention policies (turn_elements, pending_context, file_promotions cleanup)
- [ ] WAL checkpoint strategy for long-running servers (SqlRite never checkpoints)

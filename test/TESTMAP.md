# Test Map

Four test categories, each with a distinct purpose. SPEC sections
that name testable promises are anchored — `npm run test:spec`
enforces every anchored section has a backing test, and that every
test annotation references a real anchor.

## Taxonomy

### `src/**/*.test.js` — Unit tests
- Co-located with the source file under test.
- Fast (<5s for the full suite). No DB, no network, no LLM.
- Stubs and mocks at the function/class boundary.
- Run: `npm run test:unit`.

### `test/integration/*.test.js` — Integration tests
- Cross-component, in-process. Real SQLite DB. Mock LLM.
- Each file targets one slice of the contract (proposal lifecycle,
  budget math, scheme registration, etc.).
- Helpers in `test/helpers/`: `TestDb` (DB + scoped store), `TestServer`,
  `RpcClient`, `AuditClient`.
- Run: `npm run test:intg`.

### `test/live/*.test.js` — Live integration tests
- Real LLM behind a real WebSocket server. Tests verify the
  **technical contract** — what RPCs land on the wire, what state the
  DB reaches, what notifications fire. Not user-story shaped.
- Examples: streaming RPC pipeline, terminal-state notifications,
  yolo-mode server-side auto-resolution, fork-preserves-parent-store.
- Run: `npm run test:live`.

### `test/e2e/stories/*.test.js` — User-story end-to-end tests
- Each test is **one user behavior + expected outcome** against a real
  LLM. Heading describes what the user does and what they see.
- Stories don't micro-manage turns. One prompt in, outcome out.
- Helper: `test/helpers/StoryHarness.js` owns the setup (project
  fixture, server, client). Each story file is small — usually 30–50
  lines — focused on the single user behavior under test.
- Run: `npm run test:e2e`.

## Authoring guidance

**Where does a new test go?**

| Question | Answer | Category |
|---|---|---|
| Does it exercise a single function/class? | Yes | unit |
| Does it need a real DB but not a real LLM? | Yes | integration |
| Does it need a real LLM to verify a technical contract? | Yes | live |
| Does it describe a user behavior whose outcome is the assertion? | Yes | e2e |

**Story file shape:**

```js
import StoryHarness from "../../helpers/StoryHarness.js";

describe("Story: <user verb + outcome>", () => {
  const story = new StoryHarness("story_slug");
  before(() => story.setUp());
  after(() => story.tearDown());

  it("user does X, sees Y", { timeout: 480_000 }, async () => {
    const r = await story.ask("user prompt", { noInteraction: true });
    await story.client.assertRun(r, 200, "label");
    const answer = await story.lastResponse(r.run);
    assert.match(answer, /expected/);
  });
});
```

**Integration test shape (DRY contract dimensions):**

```js
const { store, runId, loopId } = await tdb.seedRun({ alias: "foo" });
// store binds runId+loopId — no per-call threading
await store.set({ turn: 1, path: "known://x", body: "..." });
```

## SPEC anchoring

SPEC sections that name behavior carry an anchor like
`{#anchor_name}`. Each must have at least one test annotation
matching `@anchor_name`. The check runs in `test/spec-coverage.js`
and is wired into `npm run test:spec`. Two pre-existing violations
(`@key_entries`, `@prompt_plugin`) are tracked outside this map.

## Counts (post-refactor)

- Unit: 910 tests across 180 suites.
- Integration: 255 tests across ~38 files.
- Live: 8 files (technical contract against real LLM).
- E2E stories: 14 files, one user behavior each.

# Testing Cards in Code Mode — Scope & Requirements

## Summary

Card authors can write **integration test** files (`.test.gts`) that live in the realm alongside their card definitions. Tests run against a fresh `MemoryRealm` seeded with data — covering real realm interactions such as card creation, search, and linked card resolution. Opening a test file in code mode shows a Test Runner panel in the RHS. Tests run in an isolated browser context so they cannot mutate host app state. The user writes assertions only — setup infrastructure is provided by the framework.

---

## Functional Requirements

### 1. LHS — File Detection & Test Indicators
- The LHS file tree distinguishes `.test.gts` files visually (e.g. a test icon or badge)
- When a `.test.gts` file is opened, code mode detects the file type and switches to test mode
- The LHS shows a per-test status indicator next to each `test()` call in the file after a run:
  - No indicator — not yet run
  - Green dot — passed
  - Red dot — failed
- Indicators update after each run and clear when the file is modified

### 2. Test Execution — Isolated Puppeteer Page per Test File
- Each test file run gets a dedicated Puppeteer page via the prerender server (`/run-tests` endpoint)
- The page navigates to `/_test-runner?module=<url>` on the host app, boots a fresh `MemoryRealm` (SQLite WASM + `TestRealmAdapter`), and runs all tests in the file
- Tests must **not** mutate the state of the host app — the Puppeteer page is a separate process with its own JS context, services, and localStorage
- The page is closed and discarded after the run — no cleanup needed, no data persisted to the live realm
- Results are returned to code mode as a single JSON response from the prerender server once all tests complete

### 3. Test Runner Lifecycle — Tracked by Code Mode
- Code mode keeps track of the active test runner instance (one per open test file)
- The runner has explicit states: `idle | running | pass | fail | error`
- Switching to a different test file tears down the previous runner and initialises a new one
- The runner does **not** auto-run on file open — the user triggers it manually

### 4. Test Result Format

Results are returned as a single JSON payload once all tests complete:

```ts
type TestResult = {
  name: string;
  status: 'pass' | 'fail' | 'error';
  duration: number;
  error?: {
    message: string;
    stack?: string;
    actual?: unknown;
    expected?: unknown;
  };
};

type TestRunResult = {
  status: 'pass' | 'fail' | 'error';
  total: number;
  passed: number;
  failed: number;
  duration: number;
  tests: TestResult[];
};
```

### 6. Manual Re-run After Editor Change
- After the user edits the test file in Monaco, they can manually trigger a re-run via the **Run** button
- The runner reloads the test module (not cached) on each run to pick up the latest editor content
- Auto-run on save is a future enhancement, not in scope

### 7. Available Imports for Test Authors
The test file has access to a set of provided helpers — no Ember/QUnit internals exposed:

```ts
import { test, setupRealm } from '@cardstack/test-support';
import { render, assert } from '@cardstack/test-support';
```

| Helper | Description |
|---|---|
| `test(name, fn)` | Register a test case |
| `setupRealm(hooks, files)` | Seed the MemoryRealm with initial card files before the test run |
| `render(component, container)` | Render a Glimmer component into a DOM container |
| `assert` | QUnit assert instance — gives access to `qunit-dom` assertions |

### 8. Assertions — DOM Only
- Assertions are DOM-based only — no network mocking, no service stubbing
- `qunit-dom` is the assertion library (already in project): `assert.dom('[data-test-name]').hasText('Alice')`
- Test authors are not expected to import from `@ember/test-helpers`, QUnit, or any Ember internals
- Any Ember internals needed (e.g. `settled()`) are used internally by the `render` helper — not exposed
- **QUnit is the underlying test runner** inside the isolated Puppeteer page — `QUnit.module`, `QUnit.test`, and `QUnit.done()` are used internally to collect the result payload. The global state collision problem does not apply here because the Puppeteer page owns its own isolated JS context with no host app QUnit instance present. The pattern mirrors the existing setup (`Testem → Chrome → QUnit`) but replaces Testem with Puppeteer: `Puppeteer (prerender server) → Chrome → /_test-runner → QUnit`

### 9. Test File Lives in the Realm
- Test files are stored in the realm as `.test.gts` files alongside card definitions
- They are editable in Monaco like any other realm file
- They are indexed by the realm as a `GtsFileDef` (same pattern as other `.gts` source files) — not as cards
- Indexing gives each test file a stable realm URL (e.g. `https://my-realm/my-card.test.gts`) which is passed to the prerender server's `/run-tests` endpoint
- The `/_test-runner` page on the host app receives this URL as a query param and dynamically imports the module via `loaderService`
- The existing Testem-based test runner (`tests/index.html`) is **not** used — it requires test files to be pre-bundled at build time and cannot load dynamic realm modules

### 10. Setup Is Framework-Provided
- The test author does not write realm boot code — `setupRealm` handles it
- `setupRealm` accepts an initial file map to seed the MemoryRealm:

```ts
setupRealm(hooks, {
  'person.gts': `...`,
  'PersonCard/alice.json': `{ "data": { ... } }`,
});
```

- Between tests, the realm is reset to the seeded state (no bleed between tests)
- Base cards (`https://cardstack.com/base/`) are available automatically

---

## UI Requirements

### 1. LHS — File Tree
- `.test.gts` files shown with a distinct icon in the file tree
- After a run, each file shows a summary badge (e.g. `3/5` passed) next to its name in the tree
- Per-test line indicators shown inline in Monaco (green/red gutter markers next to each `test()` call)

### 2. RHS — Test Runner Panel
- The Test Runner appears as a **tab alongside Spec and Playground** in the RHS panel — not a replacement
- The tab is only visible when a `.test.gts` file is open
- Switching to a non-test file hides the Test Runner tab
- A **Run** button is always visible regardless of runner state
- Any edit to the file in Monaco immediately invalidates results — all test bullets turn grey, tab resets to neutral
- Results remain visible (greyed out) after invalidation until the user manually triggers a new run

### 3. RHS — Runner State Display

| State | UI |
|---|---|
| `idle` | "Run Tests" prompt, no results, Run button prominent |
| `running` | Spinner, Run button disabled |
| `pass` | Green summary (e.g. "5 passed in 1.2s"), per-test pass indicators |
| `fail` | Red summary, failing tests expanded with assertion message and actual/expected diff |
| `error` | Module load or setup error displayed prominently with stack trace |

### 4. RHS — Test Result List
- Each test case is listed individually with its name and status icon
- Failing tests show:
  - The `qunit-dom` assertion message
  - Actual vs expected diff inline
  - Collapsible stack trace
- The panel retains the last run's results until the next run starts
- Results are displayed all at once when the full run completes

---

## Out of Scope

- Auto-run on save / watch mode (future)
- Test file indexing or search in the realm
- Snapshot testing
- Network/API mocking
- Multi-file test suites (one `.test.gts` per run)
- CI integration (separate concern)

---

## Suggested Improvements to the Spec

### 1. Isolated browser context — one Puppeteer page per test file
Each test file run gets its own dedicated Puppeteer page via the prerender server. The page is created fresh for the run, boots a `MemoryRealm`, runs all tests in that file, then is closed and discarded.

```
Code mode opens my-card.test.gts
  → POST /run-tests { module: "https://my-realm/my-card.test.gts", auth }
  → Prerender server
      └── PagePool.getPage()          ← borrows or creates a Puppeteer page
      └── page.goto('/_test-runner?module=...')
      └── MemoryRealm boots in page
      └── tests run, results streamed back
      └── page closed after run
  → RHS panel renders streamed results
```

This decision should be reflected in the functional requirements — update Requirement 2 to specify Puppeteer (not iframe) as the isolation mechanism. The iframe approach is ruled out because:
- Shares the Chrome process with the host app — a runaway test can still affect host performance
- `postMessage` protocol adds complexity for streaming results
- Puppeteer page gives true process-level isolation consistent with how prerendering already works in Boxel

### 2. Define the reset boundary between tests
The reset boundary is determined by what the test author writes, not imposed by the framework. The framework provides lifecycle hooks — the test author chooses the granularity:

```ts
// realm seeded once for the whole file
setupRealm(hooks, {
  'person.gts': `...`,
});

// per-test setup
beforeEach(async () => {
  await createCard(PersonCard, { firstName: 'Alice' });
});

// per-test teardown
afterEach(async () => {
  await deleteAllCards(PersonCard);
});
```

Available hooks: `beforeAll`, `afterAll`, `beforeEach`, `afterEach` — same model as QUnit/Mocha. `setupRealm` is always `beforeAll` scope (boots the MemoryRealm once per file run). Per-test isolation is opt-in via `beforeEach`/`afterEach`.

### 3. Scope is integration tests only
Unit-style tests (constructing cards in memory without a realm) are explicitly out of scope. All tests in `.test.gts` files are integration tests — they require a `MemoryRealm` and cover real realm interactions:

- Card creation and retrieval
- Search and query results
- Linked card resolution
- Rendered output of components that read from the realm

The MemoryRealm boot adds ~1-2s per run. This is acceptable for integration tests and avoids the complexity of supporting two different test styles with different infrastructure needs.

### 4. Test Runner tab — placement and invalidation behaviour
The Test Runner appears as a **tab at the same level as Spec and Playground** in the RHS panel. It is only visible when a `.test.gts` file is open.

**Tab states:**

| Condition | Tab appearance | Test list |
|---|---|---|
| Not yet run | Neutral tab label | Empty / "Run to see results" |
| Run completed, all pass | Green tab indicator | All green bullet points |
| Run completed, some fail | Red tab indicator | Red bullets on failing tests |
| Module edited after last run | Tab resets to neutral | All bullets turn grey — results invalidated |

**Invalidation rule:** any edit to the open `.test.gts` file in Monaco immediately invalidates the previous results — all bullets turn grey and the tab indicator resets. Results are stale until the user manually clicks Run. The framework does not auto-run on change.

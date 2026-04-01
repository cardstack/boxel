# Software Factory Testing Strategy

## Goal

Define a practical testing strategy for the software-factory work so that:

1. normal Boxel artifacts are tested like normal software
2. the one-shot orchestration flow is tested deterministically
3. the agentic loop is tested as workflow behavior, not as "AI intelligence"
4. only a small end-to-end surface remains nondeterministic

This document applies to:

- the public `DarkFactory` module in `packages/software-factory/realm`
- the `factory:go` orchestration work in `packages/software-factory/`

## TypeScript Policy

`packages/software-factory/` is a 100% TypeScript workspace.

Rules:

- new package scripts should be `.ts`
- new package tests should be `.ts`
- do not add new `.mjs` files in this package
- package scripts should be executable through typed TypeScript entrypoints, with typechecking included in package linting
- `.gts` files should follow the repo-standard Glint setup through `tsconfig.json`
- package linting currently uses `glint`, `eslint`, and `prettier`

## Realm Roles

The testing strategy assumes four separate realm roles:

- source realm
  - `packages/software-factory/realm`
  - publishes shared modules, briefs, templates, and other software-factory inputs
- target realm
  - the user-selected realm where the factory writes generated tickets, knowledge articles, and implementation artifacts
- test artifacts realm
  - a dedicated realm auto-created by the factory, named after the target realm (e.g., `my-project` → `my-project-test-artifacts`)
  - receives only card instances created during test execution (test data), not specs or results
  - each test run gets its own folder (`Run 1/`, `Run 2/`) to prevent collision between runs
  - the URL is persisted on the Project card's `testArtifactsRealmUrl` field
  - test specs live in the target realm's `Tests/` folder; TestRun result cards live in the target realm's `Test Runs/` folder
- fixture realm
  - disposable test data used to verify source-realm publishing and target-realm behavior during development

Generated factory output should normally be asserted in target realms or disposable fixture realms, not written back into the source realm. AI-generated test specs and TestRun cards belong in the target realm (co-located with the implementation). Only card instances created during test execution go to the test artifacts realm.

If the source realm includes output-like examples, they should be clearly labeled as samples rather than mixed into the canonical published tracker surface.

## AI-Generated Test Loop

The factory requires the agent to produce tests alongside implementation code. This is not optional.

Flow per ticket:

1. agent implements the card or feature in the target realm
2. agent generates test specs in the target realm (`Tests/<ticket-slug>.spec.ts`)
3. `executeTestRunFromRealm` creates a TestRun card in the target realm (`Test Runs/<slug>-<seq>.json`) with `status: running` and pre-populated `specResults` containing pending entries
4. spec files are pulled from the target realm locally; Playwright runs them against the live target realm
5. card instances created by specs during execution are written to the test artifacts realm (`Run <seq>/` folder) via `BOXEL_TEST_ARTIFACTS_FOLDER_URL`
6. test results are parsed from the Playwright JSON report, grouped by spec (top-level Playwright suite) into `SpecResult` entries, and written back to the TestRun card's `specResults` field. Each SpecResult has a `specRef` (CodeRefField with `module` = suite title, `name` = "default") and its own `passedCount`/`failedCount` computeds. TestRun's `passedCount`/`failedCount` are rolled up across all SpecResults.
7. if tests fail, the full test output (errors, stack traces) is available on the TestRun card and fed back to the agent
8. agent iterates on implementation and/or tests until all tests pass
9. passing TestRun cards serve as durable verification evidence for the ticket, linked to the Project card

This loop is the primary quality gate. A ticket cannot be marked done without at least one passing TestRun in the target realm.

## Core Principle

Do not treat the agent loop as a single black box.

Instead, split testing into layers:

1. schema and UI tests
2. deterministic orchestration tests
3. loop simulation tests
4. thin end-to-end acceptance tests

The more logic we can move into deterministic code, the less fragile the overall system becomes.

## How to Run Tests

### Node-side tests (`tests/*.test.ts`)

No prerequisites. Run directly:

```bash
pnpm test:node
```

### Playwright tests (`tests/*.spec.ts`)

Playwright tests are hermetically sealed. They start their own Postgres, Synapse, prerender server, and isolated realm server. They do not depend on any externally running realm server (e.g. `localhost:4201`).

Prerequisites:

1. Docker must be running (for Synapse)
2. Host app assets must be served at `http://localhost:4200/`:
   ```bash
   cd packages/host && pnpm serve:dist
   ```
3. Run `pnpm cache:prepare` to build or reuse the cached template database:
   ```bash
   pnpm cache:prepare
   ```

Then run the Playwright tests:

```bash
pnpm test:playwright
```

To run a specific spec file:

```bash
pnpm test:playwright --grep "bootstrap"
```

The `cache:prepare` step is a one-time setup that builds a Postgres template database from the test fixtures. It only needs to be rerun when the fixture content changes. The global setup for `pnpm test:playwright` will also run `cache:prepare` automatically if the cache is stale, but running it explicitly first avoids delays during test execution.

### All tests

```bash
pnpm test
```

This runs Node-side tests first, then Playwright tests sequentially.

## Test Location Rule

All package tests should live under `packages/software-factory/tests/`.

Use these conventions:

- `tests/*.test.ts`
  - Node-side deterministic tests such as CLI, parsing, and orchestration logic
- `tests/*.spec.ts`
  - Playwright/browser tests
- `tests/helpers/`
  - shared helpers only, not standalone test files

For Playwright specs, the fixture module should expose the realm-server
isolation mode explicitly:

- `test.use({ realmServerMode: 'shared' })`
  - default for read-only specs that can reuse one realm server within the spec
- `test.use({ realmServerMode: 'isolated' })`
  - use for mutable specs that need a fresh realm server per test

Do not add package tests under `src/`.

## What We Are Actually Testing

We are not trying to prove that a model "thinks well."

We are trying to prove that:

- briefs are normalized correctly
- project artifacts are created correctly
- ticket state transitions are correct
- verification gates are enforced
- reruns resume instead of duplicating work
- failure paths are handled predictably

## Layer 1: DarkFactory Schema and UI

This is the straightforward part.

Test the `DarkFactory` cards like normal Boxel artifacts:

- `Project`
- `Ticket`
- `KnowledgeArticle`
- `AgentProfile`

Coverage should include:

- public resolution from the published `darkfactory` module as served by the isolated software-factory test harness
- rendering of the shared tracker cards
- cross-realm adoption by an external realm
- any card queries or embedded relations used by the tracker UI

These tests should be deterministic and should not involve the agent loop.

Fixture policy for this layer:

- treat `packages/software-factory/realm` as the published source realm, not as mutable test state
- keep test-only card instances in fixture realms dedicated to testing
- have fixture realms adopt from the public `darkfactory` module URL instead of copying the tracker module
- run browser tests against disposable per-test runtime clones of those fixture realms so mutations can be torn down safely

If the public realm includes demo instances, they are there for manual exploration, smoke checks, and as-shipped examples of the published module. They should not be the primary place where tests create or mutate state, and any output-like examples should be clearly separated as sample output.

## Layer 2: Deterministic Orchestration Tests

The `factory:go` command should mostly be testable without a real model.

Focus areas:

- argument parsing
- brief loading
- brief normalization
- target-realm bootstrap
- project artifact bootstrap
- verification-policy selection
- resume and idempotency behavior

These should be covered with unit tests and focused integration tests.

Hermetic requirement for this layer:

- deterministic `factory:go` tests must not depend on an ambient realm server on `http://localhost:4201/`
- deterministic `factory:go` tests must not hard-code `localhost:4201` or port `4201` just to get an absolute URL shape
- when a test only needs an absolute URL shape, use a synthetic URL such as `https://briefs.example.test/...`
- prefer reserved synthetic hosts such as `*.example.test` or dynamically assigned local test-server ports over canonical dev ports
- when a test needs a live realm, use the isolated software-factory harness rather than external local infrastructure
- the only acceptable exceptions are harness-level redirect tests that intentionally intercept a canonical realm URL without depending on a server actually listening on that port

Debugging note:

- if tests fail or behave oddly in CI but not locally, first check whether a supposedly hermetic test is accidentally leaking and relying on an external local server or other ambient infrastructure
- a common smell is a test that passes only when `localhost:4201` or another developer-run service happens to be up
- verify hermetic assumptions by stopping ambient local services and rerunning the affected tests against only the software-factory harness

Examples:

- a public wiki card becomes a normalized brief object
- a vague brief defaults to thin-MVP planning
- a missing target realm gets bootstrapped correctly via `/_create-realm` while reusing the public tracker module URL
- rerunning bootstrap does not create duplicate cards
- existing `in_progress` tickets are resumed instead of replaced

## Terminology: "Spec" Disambiguation

**IMPORTANT:** "Spec" has two completely different meanings in the software factory:

1. **Catalog Spec card** (`Spec/` folder, `.json` files) — A card instance adopting from `https://cardstack.com/base/spec#Spec`. This is a catalog entry describing a card. Example: `Spec/sticky-note.json`.

2. **Playwright test file** (`Tests/` folder, `.spec.ts` files) — A TypeScript Playwright test file that runs browser-level verification. Example: `Tests/sticky-note.spec.ts`.

In tests, docs, and code, always use the qualified form. Never use bare "spec" without qualification.

## Layer 3: Loop Simulation Tests

This is the main strategy for testing the agentic loop.

Do not use a real LLM for most loop tests.

Use `MockFactoryAgent` (from `scripts/lib/factory-agent.ts`) — a test double that takes pre-configured `AgentAction[][]` responses and returns them in sequence from `plan()`. It records every `AgentContext` it receives, enabling assertions about what the orchestrator fed the agent.

The agent produces actions using these actual action types:

- `create_file` — create a card definition (.gts) or card instance (.json) in a realm
- `update_file` — replace the content of an existing file
- `create_test` — create a Playwright test file in the target realm's `Tests/` folder
- `update_test` — update an existing Playwright test file
- `update_ticket` — update the current ticket with notes or status changes
- `create_knowledge` — create a knowledge article
- `invoke_tool` — run a registered tool (search-realm, realm-read, etc.)
- `request_clarification` — signal that the agent cannot proceed
- `done` — signal that all work for this ticket is complete

Then test the loop as a state machine.

### Required test cases for `tests/factory-loop.test.ts`

1. **Happy path** — agent returns file actions + `create_test` + Catalog Spec card on iteration 1; tests pass; loop returns `tests_passed` with `iterations: 1`
2. **Iteration path** — agent returns file actions on iteration 1; tests fail; agent returns fix actions on iteration 2; tests pass; loop returns `tests_passed` with `iterations: 2`
3. **Max iterations** — agent keeps producing actions, tests keep failing for 5 iterations; loop returns `max_iterations`
4. **Done signal** — agent returns `[{ type: 'done' }]` on first call; loop returns `done` with `iterations: 1`
5. **Clarification** — agent returns `request_clarification`; loop returns `clarification_needed`
6. **Tool-only round** — agent returns only `invoke_tool` actions (no files); loop feeds tool results back and calls `plan()` again; agent returns file actions on second call; tests pass
7. **Context threading** — verify that `MockFactoryAgent.receivedContexts` shows correct `testResults`, `toolResults`, `previousActions`, and `iteration` values across iterations
8. **Orchestrator-owned sequencing** — verify that all file writes complete before test execution begins
9. **Catalog Spec card creation** — verify that the agent's `create_file` for `Spec/*.json` is written to the target realm alongside the card definition and Playwright test file

Assertions should be about workflow behavior:

- the right ticket is chosen
- the right state transitions occur
- failed verification keeps the ticket open
- successful verification advances the loop
- clarification paths stop correctly
- retries and resumes are handled correctly
- Catalog Spec cards are written to the target realm

Do not assert exact natural-language output from the model.

## Layer 4: Thin End-to-End Acceptance Tests

Keep only a small number of true end-to-end tests.

Suggested acceptance cases:

1. Sticky Note bootstrap
   - brief URL points to `software-factory/Wiki/sticky-note`
   - target realm is a scratch or temp realm
   - result is one project, starter knowledge cards, and starter tickets

2. Sticky Note first implementation pass
   - loop executes the first active ticket
   - one implementation artifact is created (card definition + card instance)
   - one Catalog Spec card is created in the `Spec/` folder
   - one Playwright test file is created in the `Tests/` folder
   - one TestRun card is created in the `Test Runs/` folder with verification results

3. Resume after partial progress
   - rerun after partial state
   - loop resumes instead of recreating artifacts

These tests are slower and more brittle, so keep them few and high-signal.

## What Not To Test Directly

Avoid tests that depend on:

- exact phrasing of generated text
- exact ticket wording
- exact `agentNotes` wording
- full open-ended model behavior

Those tests will be noisy and hard to maintain.

## Recommended Test Shape By Work Area

### Public DarkFactory Module

Use:

- focused card rendering tests
- cross-realm adoption integration tests

Notes:

- assertions should prove that external fixture realms can resolve cards from the public module URL
- tests should mutate only disposable fixture realms, never the published `packages/software-factory/realm`

### `factory:go` Entry Point

Use:

- unit tests for CLI argument parsing
- integration tests for command startup and summary output

Location:

- keep these tests as top-level `packages/software-factory/tests/*.test.ts`, not under `src/`

### Brief Normalization

Use:

- pure unit tests with fixture brief payloads

### Target Realm Bootstrap

Use:

- temporary-directory integration tests
- bootstrap tests that cover missing-realm creation through `/_create-realm`
- readiness checks that treat a successful `/_create-realm` response as the readiness boundary
- tests that require `MATRIX_USERNAME` instead of an explicit brief JWT flag

### Project Artifact Bootstrap

Use:

- temporary-realm integration tests
- rerun/idempotency tests

Notes:

- assert generated artifacts in a temporary or user-style target realm
- do not treat the published source realm as the destination for factory output

### Verification Policy

Use:

- pure unit tests

### Execution Loop

Use:

- `MockFactoryAgent`-based loop simulation tests (see Layer 3 above for the full list of required test cases)
- action dispatcher tests with mock `fetch` and mock `ToolExecutor`
- context builder tests with mock skill resolver/loader

### Resume and Idempotency

Use:

- integration tests plus loop simulation tests

## Suggested First Test Milestones

These are the highest-value early tests:

1. public `DarkFactory` module resolves from an adopter realm
   - use a dedicated fixture realm, not the published realm itself, for any mutable test setup
2. brief normalization handles the sticky-note wiki card
3. target realm bootstrap creates required surfaces in a temp realm
4. artifact bootstrap creates one project and one `in_progress` ticket
5. rerunning bootstrap does not duplicate artifacts
6. fake loop test covers success path
7. fake loop test covers failed verification path
8. one end-to-end sticky-note acceptance test

## Ticket Mapping

Testing is part of implementation and should stay attached to the current Linear tickets.

The current mapping is:

- `CS-10444`
  - public module resolution and rendering coverage
- `CS-10445`
  - adopter-realm integration verification
- `CS-10446`
  - CLI entrypoint tests
- `CS-10447`
  - brief-normalization unit tests
- `CS-10448`
  - target-realm bootstrap integration tests
- `CS-10449`
  - artifact-bootstrap and idempotency integration tests
- `CS-10451`
  - verification-policy unit tests
- `CS-10450`
  - execution loop implementation, broken into child tickets:
    - action dispatcher (apply `AgentAction[]` to realms via HTTP)
    - context builder (assemble `AgentContext` from skills, tools, realm state)
    - core loop orchestrator (plan → execute → test → iterate cycle)
    - wire loop into `factory:go --mode implement`
- `CS-10452`
  - resume and rerun tests
- `CS-10453`
  - docs accuracy validation

## Summary

The testing approach is:

- test Boxel artifacts normally
- test orchestration deterministically
- test the loop with simulation
- keep real end-to-end coverage thin

In short:

test the software factory like workflow software, not like a general intelligence benchmark.

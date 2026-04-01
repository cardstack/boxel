# One-Shot Software Factory Plan

## Goal

Turn the current `experiment_1` workflow from an agent-assisted toolbox into a single-entrypoint flow that can:

1. accept a brief URL like `http://localhost:4201/software-factory/Wiki/sticky-note`
2. target a Boxel realm URL such as `http://localhost:4201/hassan1/personal/`
3. bootstrap project artifacts in that target realm
4. immediately enter implementation and verification iterations
5. stop only when a clear completion or blocker condition is reached

This document covers:

- the desired one-shot flow
- what is currently missing
- the minimum implementation needed in `experiment_1`

## Assumptions

- `factory:go` must not assume it is co-located on the same filesystem as the target realm.
- Target-realm bootstrap and artifact creation should use realm HTTP APIs and realm URLs rather than local file writes into the realm directory.
- Local filesystem paths may still be useful as user hints or local workspace references, but they should not be the source of truth for manipulating target-realm contents.

## Realm Roles

The software factory uses four different realm roles that should stay distinct:

- source realm
  - `packages/software-factory/realm`
  - publishes shared modules, source cards, briefs, templates, and other driver content
- target realm
  - the user-specified realm passed to `factory:go`
  - receives the generated `Project`, `Ticket`, `KnowledgeArticle`, and implementation artifacts
- test artifacts realm
  - a dedicated realm auto-created by the factory, named after the target realm (e.g., `smoke-1` → `smoke-1-test-artifacts`)
  - receives only card instances created during test execution (not specs or test results)
  - each test run gets its own folder (`Run 1/`, `Run 2/`) to prevent collision between runs
  - the test artifacts realm URL is persisted on the Project card's `testArtifactsRealmUrl` field
  - specs live in the target realm's `Tests/` folder; TestRun cards live in the target realm's `Test Runs/` folder
- fixture realm
  - disposable test input used only for development-time verification of the factory itself
  - may adopt from the public source realm but should not be treated as user output

Normal factory output should land in the target realm, not in `packages/software-factory/realm`. AI-generated test specs and TestRun result cards live in the target realm (co-located with the implementation). Only card instances created during test execution (test data) go to the test artifacts realm.

If we intentionally include output-like examples in the source realm, they should be clearly labeled as examples and live in an obviously non-canonical location such as `SampleOutput/` or `Examples/`.

## Package Boundary Rule

Implementation inside `packages/software-factory/` must not use relative imports that cross into another workspace package, for example `../../../realm-server/...`.

If `software-factory` needs a small utility that currently lives in another package, one of these should happen instead:

- copy the tiny module locally when the behavior is package-specific and intentionally duplicated
- move the shared code into an explicit shared package or shared module location
- consume it through a stable package entrypoint rather than a cross-package relative path

Do not couple `software-factory` runtime code to another package's private file layout.

## Current State

`experiment_1` already has useful primitives:

- `scripts/boxel-session.ts`
  - gets browser-local auth/session payloads
- `scripts/boxel-search.ts`
  - searches a realm via `_search`
- `scripts/pick-ticket.ts`
  - finds candidate tickets
- `scripts/run-realm-tests.ts`
  - runs realm-hosted Playwright tests against a scratch realm
- `realms/guidance-tasks/darkfactory-schema.gts`
  - defines `Project`, `Ticket`, `KnowledgeArticle`, `AgentProfile`
- `realms/guidance-tasks/darkfactory-ui.gts`
  - renders those cards
- `AGENTS.md` and repo-local skills
  - describe the intended software-factory loop

What does not exist yet is a real orchestrator that binds these parts together.

## Desired UX

The target user experience is one command or one prompt:

```bash
npm run factory:go -- \
  --brief-url http://localhost:4201/software-factory/Wiki/sticky-note \
  --target-realm-url http://localhost:4201/hassan1/personal/ \
  [--realm-server-url http://localhost:4201/] \
  --mode implement
```

Or agent-side:

```text
Use the public brief at http://localhost:4201/software-factory/Wiki/sticky-note.
Bootstrap the project in my personal realm, then immediately start implementation and testing iterations until the MVP is done or blocked.
```

The important property is that the user should not need to manually:

- create project cards
- create ticket cards
- decide the first ticket
- choose the first verification approach
- hand-hold the transition from planning into implementation

## Required One-Shot Flow

### Phase 1: Intake

Inputs:

- `brief-url`
- `target-realm-url`
- optional `realm-server-url`
- optional mode:
  - `bootstrap`
  - `implement`
  - `resume`

Required behavior:

- fetch the brief card JSON
- normalize the brief into a concise internal representation
- prepare a prompt for the AI to decide whether to default to a thin MVP
- prepare a prompt for the AI to create clarification or review tickets when the brief needs more guidance

### Phase 2: Target Realm Preparation

Required behavior:

- require `MATRIX_USERNAME` so the target realm owner is explicit before bootstrap starts
- infer the target realm server URL from the target realm URL by default, but allow an explicit override when the realm server lives under a subdirectory and the URL shape is ambiguous
- create missing target realms through the realm server `/_create-realm` API rather than by creating local directories directly
- create the companion test realm (`<target-realm-name>-tests`) through the same `/_create-realm` API
- treat the successful `/_create-realm` responses for both realms as the readiness boundary

Minimum requirement:

- the target realm must be self-contained enough that `Project`, `Ticket`, and `KnowledgeArticle` cards resolve locally
- the test realm must be able to adopt from the target realm and execute tests against cards hosted there

### Phase 3: Bootstrap Project Artifacts

Required behavior:

- create or update one `Project`
- create or update one or more `KnowledgeArticle` cards
- create starter `Ticket` cards
- mark exactly one starter ticket as `in_progress`

Artifact location rule:

- these generated artifacts belong in the target realm selected by the user, not in the source realm that publishes the shared software-factory modules

Rules:

- do not duplicate artifacts if they already exist
- derive stable identifiers from the brief intent where possible
- record assumptions explicitly when the brief is underspecified

### Terminology: "Spec" Disambiguation

**IMPORTANT:** "Spec" has two completely different meanings in this system. All code, docs, and prompts must use the qualified form to avoid confusion:

1. **Catalog Spec card** (`Spec/` folder, `.json` files) — A card instance that adopts from `https://cardstack.com/base/spec#Spec`. This is a **catalog entry** describing a card for inclusion in the Boxel catalog. It has fields like `ref` (CodeRef pointing to the card definition), `specType` (`'card'`|`'field'`|`'component'`), `readMe` (markdown description), `cardTitle`, and `cardDescription`. Example: `Spec/sticky-note.json` describes the StickyNote card.

2. **Playwright test file** (`Tests/` folder, `.spec.ts` files) — A TypeScript Playwright test file that runs browser-level verification against the live realm. Example: `Tests/sticky-note.spec.ts` tests that StickyNote renders correctly.

Never use bare "spec" without qualification. Use **"Catalog Spec card"** for #1 and **"Playwright test file"** or **"test file"** for #2.

### Phase 4: Execution Loop

Required behavior:

1. pick the active or next available ticket
2. resolve skills for the current ticket via `SkillResolver`
3. load skills from `.agents/skills/` via `SkillLoader`
4. build tool manifest from `ToolRegistry` (script and realm-api tools only; boxel-cli tools are excluded until CS-10520 lands)
5. assemble `AgentContext` (project, ticket, knowledge, skills, tools, test results)
6. call `agent.plan(context)` to get `AgentAction[]`
7. execute `invoke_tool` actions via `ToolExecutor`, capture `ToolResult`s
8. apply file actions to the target realm via realm HTTP API
9. orchestrator triggers test execution (after all file writes complete)
10. if tests fail → update `AgentContext` with test results, go to step 6
11. if tests pass → save results in target realm, update ticket status, advance
12. `maxIterations` (default: 5) prevents infinite loops

#### Concrete Data Flow Per Iteration

The agent produces code, cards, Catalog Spec cards, and Playwright test files as `AgentAction[]` — each action contains the **full file content** inline. The orchestrator/dispatcher writes them to the realm via HTTP.

```
1. Orchestrator calls agent.plan(context) → AgentAction[]
   Agent returns actions like:
   [
     { type: "create_file", path: "sticky-note.gts", realm: "target",
       content: "import { CardDef, ... } from '...'; export class StickyNote ..." },
     { type: "create_file", path: "StickyNote/welcome-note.json", realm: "target",
       content: "{ \"data\": { ... sample card instance with realistic data ... } }" },
     { type: "create_file", path: "Spec/sticky-note.json", realm: "target",
       content: "{ \"data\": { ... Catalog Spec card with linkedExamples → sample instance ... } }" },
     { type: "create_test", path: "Tests/sticky-note.spec.ts", realm: "target",
       content: "import { test, expect } from '@playwright/test'; ..." }
   ]

2. Dispatcher writes each action to the correct realm via HTTP:
   - .gts/.ts files → writeModuleSource(realmUrl, path, content, { authorization })
     POST to realm URL with raw source text body
   - .json files → writeCardSource(realmUrl, path, JSON.parse(content), { authorization })
     POST to realm URL with JSON-API card source body
   - realm selection: action.realm === 'target' → targetRealmUrl
   - auth: per-realm JWT from realmTokens[realmUrl]

3. After ALL writes complete, orchestrator runs tests:
   executeTestRunFromRealm({ targetRealmUrl, specPaths, ... })
   - Pulls Playwright test files from realm to local temp dir
   - Runs Playwright against the LIVE target realm (no local harness)
   - Creates TestRun card in target realm's "Test Runs/" folder
   - Returns TestRunHandle { status: 'passed' | 'failed', testRunId }

4. If failed: orchestrator reads TestRun card for failure details,
   builds TestResult with failures[].testName, failures[].error,
   failures[].stackTrace, feeds into AgentContext.testResults.
   Agent sees the failure in the iteration prompt and produces fix actions.
```

The agent does **not** execute anything directly. All side effects — realm writes, test execution, result parsing — are owned by the orchestrator/dispatcher.

#### Catalog Spec Card Requirement

For each top-level card defined in the brief, the agent must create a Catalog Spec card instance in the target realm's `Spec/` folder. This is the catalog entry that makes the card discoverable. Only the top-level card needs a Catalog Spec card — not every helper field or sub-component.

The Catalog Spec card shape (from `packages/base/spec.gts`):

```json
{
  "data": {
    "type": "card",
    "attributes": {
      "ref": { "module": "../sticky-note", "name": "StickyNote" },
      "specType": "card",
      "readMe": "# StickyNote\n\nA simple sticky note card with title and body fields.",
      "cardTitle": "Sticky Note",
      "cardDescription": "A sticky note card for quick notes",
      "containedExamples": []
    },
    "relationships": {
      "linkedExamples": {
        "links": {
          "self": "../StickyNote/welcome-note"
        }
      }
    },
    "meta": {
      "adoptsFrom": {
        "module": "https://cardstack.com/base/spec",
        "name": "Spec"
      }
    }
  }
}
```

Key fields:

- `ref.module`: relative path from the Catalog Spec card instance to the `.gts` definition (e.g., `../sticky-note` from `Spec/sticky-note.json`)
- `ref.name`: the exported class name
- `specType`: `'card'` for CardDef, `'field'` for FieldDef, `'component'` for standalone components
- `readMe`: markdown documentation for the card
- `cardTitle` / `cardDescription`: human-readable title and short description
- `linkedExamples`: a `linksToMany` relationship pointing to sample card instances that demonstrate the card in use. The agent must create at least one sample instance (e.g., `StickyNote/welcome-note.json`) and link it here.

#### Sample Card Instances

The agent must create at least one sample card instance for the top-level card. Sample instances serve as:

- **Catalog examples** — linked from the Catalog Spec card via `linkedExamples`, they appear in the catalog as usage demonstrations
- **Test fixtures** — Playwright test files can navigate to these instances to verify rendering

Sample instances live in the target realm alongside other card instances (e.g., `StickyNote/welcome-note.json`). They should have realistic, meaningful attribute values — not empty or placeholder data.

Reference: `src/cli/smoke-test-realm.ts` creates a Catalog Spec card as part of its smoke test. Real-world Catalog Spec cards live in `packages/catalog-realm/Spec/`.

#### Auth Model

The execution loop uses three distinct JWT levels:

1. **Realm server JWT** (`serverToken`) — obtained via `matrixLogin()` + `getRealmServerToken()`. Used for server-level operations like `_create-realm` and `_realm-auth`.
2. **Per-realm JWTs** (`realmTokens: Record<string, string>`) — obtained via `getRealmScopedAuth(realmServerUrl, serverToken)`. Each realm URL maps to its own JWT. Used for all realm reads/writes (`writeCardSource`, `writeModuleSource`, `readCardSource`, `searchRealm`).
3. **Test artifacts realm JWT** — a per-realm JWT for the auto-created test artifacts realm, obtained separately after that realm is created. Handled internally by `executeTestRunFromRealm()`.

The dispatcher looks up the correct per-realm JWT based on which realm each action targets.

#### Tool Availability

Boxel-cli tools (`boxel-sync`, `boxel-push`, `boxel-pull`, etc.) are excluded from the agent's tool registry until CS-10520 lands (boxel-cli auth integration). The `ToolRegistry` is constructed with only `SCRIPT_TOOLS` and `REALM_API_TOOLS`. All file operations use the realm HTTP API directly.

Test generation rule:

- the agent must produce at least one Playwright test file per ticket before a ticket can be marked as done
- Playwright test files live in the target realm's `Tests/` folder (e.g., `Tests/<ticket-slug>.spec.ts`)
- test artifacts include both the Playwright test source code and the structured test execution results (TestRun cards)
- failed test output is the primary feedback signal that drives the implement-verify loop

### Phase 5: Verification

Verification is mandatory. Every ticket must have AI-generated Playwright test files before it can be marked done.

Test generation policy:

- the agent creates Playwright test files in the target realm's `Tests/` folder that exercise the cards and behavior implemented for the current ticket
- for Boxel card work, tests should at minimum verify that card instances render correctly in fitted, isolated, and embedded views
- additional tests should cover card-specific behavior, field values, relationships, and interactions
- the agent should start with the smallest meaningful test and expand coverage if the first test passes trivially

Test execution policy:

- the orchestrator owns test execution — the agent only produces `create_test`/`update_test` actions, and the orchestrator triggers test execution as a separate phase after all file writes complete
- Playwright test files are pulled from the target realm to a local temp directory, then run via Playwright against the live target realm
- test results (pass/fail, error messages, stack traces) are saved as `TestRun` card instances in the target realm's `Test Runs/` folder
- on failure, the full test output is fed back to the agent as context for the next implementation attempt
- on success, the TestRun card serves as durable proof that the ticket was verified

Target realm artifact structure (Playwright test files and results co-located with implementation):

- `Tests/<ticket-slug>.spec.ts` — the generated Playwright test source (in target realm)
- `Test Runs/<ticket-slug>-<seq>.json` — TestRun card instance with status, results, timing (in target realm)
- `Spec/<card-name>.json` — Catalog Spec card for the top-level card (in target realm)

Test artifacts realm (auto-created from project name, e.g., `Sticky Notes Test Artifacts`):

- `Run 1/` — card instances created during test run 1
- `Run 2/` — card instances created during test run 2

All card instance folders use plural display names: `Projects/`, `Tickets/`, `Knowledge Articles/`, `Agent Profiles/`, `Test Runs/`, `Tests/`, `Spec/`.

Implementation note:

- the Playwright harness in `packages/software-factory` is reused to execute AI-generated Playwright test files
- this gives the factory a real browser-level verification path for generated cards
- the test harness output format should match what the agent needs to diagnose failures and iterate
- the test artifacts realm is auto-created from the project name and its URL is persisted on the Project card (`testArtifactsRealmUrl` field)
- before test execution, all indexing jobs (running + pending) are cancelled on the test artifacts realm via `_cancel-indexing-job` with `cancelPending: true`

### Phase 6: Stop Conditions

The one-shot flow should stop only when one of these becomes true:

- `Project.successCriteria` are satisfied for the intended MVP
- an explicit blocker requires human clarification
- auth, server availability, or realm integrity prevents further progress

It should not stop simply because bootstrap is complete.

## What Is Missing Today

### 1. A Real Orchestrator

There is no command that owns the full lifecycle from brief intake through repeated ticket execution.

### 2. Deterministic Brief-to-Artifact Rules

The bootstrap logic currently lives in agent judgment. It needs stable rules for:

- project naming
- ticket count and order
- assumption capture
- idempotent updates on rerun

### 3. Target Realm Bootstrap

The target realm currently needs explicit bootstrap through the realm-server API. Shared tracker modules should be reused from the public source realm rather than copied into each target realm.

### 4. Resume Semantics

The system needs to resume from existing state instead of recreating everything on rerun.

### 5. Default Verification Policy

The first verification move should be encoded so the runner knows what to do when there are no tests yet.

### 6. Execution Policy

The current behavior is described in prose, but not encoded as a decision engine. The one-shot flow needs explicit answers to:

- when to keep implementing
- when to create new tickets
- when to capture knowledge
- when to ask the user a question

### 7. Sequential Async Tool Calls and Long-Running Operations

The execution loop involves operations with causal dependencies that must execute in sequence. For example, the verify step requires:

1. Write test spec to the target realm `Tests/` folder (via `realm-write`)
2. Write a `TestRun` card to the target realm `Test Runs/` folder (via `realm-write`)
3. Execute tests against the target realm (via `run-realm-tests`); any data created during execution is stored in the test artifacts realm
4. Parse and save test results back to the `TestRun` card in the target realm
5. Feed results back to the agent for the next iteration

The current `AgentAction[]` model is a flat array — it does not express causal ordering between actions. The orchestrator must either:

- **Implicit sequencing**: The orchestrator always runs writes before test execution, treating the action array as an unordered set that it sequences according to hardcoded rules (write → execute → parse → iterate).
- **Explicit sequencing**: Extend the action model to support ordered groups or dependency edges, so the agent can express "write this, then run that."
- **Orchestrator-owned verification step**: The orchestrator owns the test execution step entirely — the agent only produces `create_test`/`update_test` actions, and the orchestrator triggers test execution as a separate phase after all file writes complete. This is the approach implied by the current Phase 4/5 design.

The third approach (orchestrator-owned verification) is the simplest and most aligned with the current plan. The agent never invokes `run-realm-tests` directly — the orchestrator does, after executing all agent-requested writes.

**Long-running test execution**: Test execution can take ~10 minutes per run. The orchestrator process may be interrupted by SIGTERM or SIGKILL during this time. The system must be able to resume from where it left off:

- **State persistence via realm cards**: All orchestration state that must survive process restarts should be persisted as card instances in the realm — specifically, darkfactory cards like `Ticket` (status, agentNotes) and `AgentExecutionLog` (iteration history, last action set, pending test run). This means the realm is the source of truth, not in-memory state or local files.
- **Idempotent phases**: Each phase of the loop (write specs → run tests → save results → iterate) should be idempotent or at minimum safe to re-execute. If the process dies during test execution, the next run should detect that tests were not completed (no `TestResult` artifact for the current iteration) and re-run them.
- **Checkpoint pattern**: Before starting a long-running operation (test execution), the orchestrator writes a "pending" state to the execution log card. On completion, it updates to "completed" with results. On resume, the orchestrator checks for pending states and re-executes the interrupted operation.

**Reference**: The `ai-bot` workspace in the Boxel monorepo implements async tool call sequencing for user-agent interaction. While that system is oriented around conversational turns rather than one-shot execution, its patterns for managing tool call ordering, result threading, and state persistence may inform the `factory-loop.ts` implementation. The key difference is that `ai-bot` operates in a request-response loop with the user, while the factory loop is autonomous — but the underlying sequencing and state management challenges are similar.

## Minimal Implementation Plan For `experiment_1`

This plan aims for the smallest change set that produces a believable `factory:go` flow.

## Scope

Add a new script and a small shared library layer. Do not attempt a fully autonomous general planner on the first pass.

The first version should support:

- one brief URL
- one target realm URL
- Boxel-card implementation workflows
- simple bootstrap and first-ticket execution

## Proposed New Entry Point

Add a script:

```json
"factory:go": "ts-node --transpileOnly src/cli/factory-entrypoint.ts"
```

For software-factory CLI entrypoints, favor `ts-node --transpileOnly` over `tsx`.

- it matches the execution model already used by `realm-server`
- it avoids the decorator/runtime incompatibilities we hit when `tsx` imports `runtime-common` auth code
- it keeps package CLI entrypoints aligned with the `runtime-common` auth infrastructure instead of forcing parallel implementations

Expected usage:

```bash
npm run factory:go -- \
  --brief-url http://localhost:4201/software-factory/Wiki/sticky-note \
  --target-realm-url http://localhost:4201/hassan1/personal/ \
  [--realm-server-url http://localhost:4201/] \
  --mode implement
```

CLI parameters for the first version:

- `--brief-url`
  - Required. Absolute URL for the brief card that drives the one-shot flow.
- `--target-realm-url`
  - Required. Absolute URL for the realm where generated artifacts should land.
- `--realm-server-url`
  - Optional. Explicit realm server URL for target-realm bootstrap when it should not be inferred from the target realm URL.
- `--mode`
  - Optional. `bootstrap`, `implement`, or `resume`. Default should be `implement`.
- `--model`
  - Optional. OpenRouter model ID (e.g., `anthropic/claude-sonnet-4.6`, `openai/gpt-4o`). Can also be set via `FACTORY_LLM_MODEL` environment variable. Falls back to the Boxel default coding model.
- `--help`
  - Optional. Prints command usage and exits without running the flow.

## Proposed Implementation Pieces

### A. `scripts/factory-go.ts`

This should be the top-level orchestrator.

Responsibilities:

- parse args
- fetch the brief
- resolve the target realm URL
- resolve the realm server URL for bootstrap
- bootstrap or reconcile project artifacts
- pick the next ticket
- invoke the implementation loop
- print a structured summary at the end

This file should stay thin and delegate to helpers.

### B. `scripts/lib/factory-bootstrap.ts`

New helper module for creating or updating:

- `Project`
- `KnowledgeArticle`
- `Ticket`

Responsibilities:

- turn a fetched brief into an internal normalized shape
- generate stable filenames and IDs
- write JSON artifact files idempotently
- avoid duplicating cards on reruns

For the first version, hard-code the bootstrap pattern:

- one project
- two knowledge articles
- three tickets
- one active ticket

That is enough for a thin MVP flow.

### C. `scripts/lib/factory-target-realm.ts`

New helper module for target realm preparation.

Responsibilities:

- validate the explicit target realm URL
- create the target realm through `POST /_create-realm` when needed
- create the companion test realm (`<target-realm-name>-tests`) through the same API
- return both the target realm and test realm bootstrap results

This isolates the realm bootstrapping concern from the orchestration logic.

### D. `scripts/lib/factory-brief.ts`

New helper module for brief intake.

Responsibilities:

- fetch a brief card by URL
- extract useful fields from card JSON
- normalize the brief into a concise planning input
- emit metadata like:
  - title
  - summary
  - content
  - source URL
  - structured fields that a later AI stage can use for thin-MVP vs broader-first-pass planning
  - enough context for later clarification and review follow-up ticket decisions

For version one, this helper can stay deterministic and data-oriented. Later AI stages should combine the structured brief fields with a stable prompt template rather than embedding a fully rendered prompt into `factory:go` output.

### E. `scripts/lib/factory-loop.ts`

New helper module for the first execution loop.

Responsibilities:

- find the active ticket
- if no active ticket, use the first eligible backlog ticket
- gather related knowledge and project context
- call the implementation backend
- invoke test generation for the completed work
- run tests via the test harness and capture results
- feed test failures back to the agent for iteration
- update ticket state and notes after tests pass

For the first version, this does not need to be a general autonomous system. It only needs to perform one ticket deeply and leave the realm in a coherent state. However, it must complete the full implement → generate tests → run tests → iterate cycle before marking a ticket done.

### F. `scripts/lib/factory-test-realm.ts`

Helper module for managing test execution and results in the test realm.

#### Key Design Decisions

- **Test spec writing uses normal `realm-write`** — no special mechanism. The agent's `create_test`/`update_test` actions route through the same ToolExecutor.
- **Test results are `TestRun` card instances**, not plain JSON files. A new card definition (`realm/test-results.gts`) defines `TestRun` (CardDef) and `TestResultEntry` (FieldDef).
- **TestRun is created at start** with `status: running` and pre-populated `pending` result entries. The card ID is the primary handle returned to callers.
- **Incremental updates**: Each test result is written to the card as it completes (pending → passed/failed), enabling precise resume after interruption.
- **Resume behavior**: On start, queries for the most recent TestRun (by `sequenceNumber` desc). If it has `status: running`, resumes it by only running pending tests. `forceNew: true` option skips resume.

#### Responsibilities

- Parse raw Playwright output into `TestRunAttributes` (the serialized card shape)
- Create `TestRun` cards with `status: running` and pre-populated `pending` results
- Update `TestRun` cards with completion results (uses `LooseSingleCardDocument` from `@cardstack/runtime-common`)
- Determine resume vs new run via realm-search query (type filter on TestRun, sorted by sequenceNumber desc)
- Pull remote realm files to local temp directory (via `_mtimes` endpoint)
- Orchestrate the full test execution flow: create card → pull realms → run harness → stream results → complete card
- Format results for agent iteration prompts

#### Card Definitions (`realm/test-results.gts`)

- `TestRunStatusField` — enum: running, passed, failed, error
- `TestResultStatusField` — enum: pending, passed, failed, error
- `TestResultEntry` (FieldDef) — testName, status, message, stackTrace, durationMs
- `SpecResult` (FieldDef) — specRef (CodeRefField), results (containsMany TestResultEntry), passedCount (computed), failedCount (computed)
- `TestRun` (CardDef) — sequenceNumber, runAt, completedAt, ticket (linksTo), status, passedCount (computed, rolled up from specResults), failedCount (computed, rolled up from specResults), durationMs, specResults (containsMany SpecResult), errorMessage, title (computed)

A TestRun contains multiple SpecResults, each grouping test results under a spec reference. The specRef's `module` field identifies the spec file (e.g., the Playwright suite title). Counts on TestRun are aggregated across all SpecResults.

#### Return Type

```
TestRunHandle { testRunId: string; status: 'running'|'passed'|'failed'|'error'; errorMessage?: string }
```

The orchestrator only needs the ID and pass/fail signal. On `error`, the `errorMessage` tells you why. On `failed`, read the TestRun card for individual failure details.

#### Auth

The caller provides an authenticated `fetch` via `createBoxelRealmFetch` from `src/realm-auth.ts` — the same pattern used in `factory-entrypoint.ts`. The test realm module itself does not handle Matrix credentials.

The test realm acts as durable verification evidence. Each ticket gets at least one test spec and one test result artifact. Failed test output is the primary feedback signal driving the implement-verify loop.

## Implementation Backend Choice

This is the main architectural decision.

There are two options:

### G. `scripts/lib/realm-operations.ts`

Shared realm HTTP operations extracted from `boxel.ts`, `factory-test-realm.ts`, and `factory-tool-executor.ts`. Centralizes:

- `searchRealm()` — QUERY to `_search` endpoint
- `readCardSource()` / `writeCardSource()` — card read/write with card source MIME type
- `pullRealmFiles()` — HTTP-based realm download via `_mtimes` (TODO: replace with `boxel pull --jwt` per CS-10529)
- `ensureTrailingSlash()`, `buildAuthHeaders()`, `buildCardSourceHeaders()`, `cardSourceMimeType`

Design rule: **prefer using existing tools (boxel-cli, realm-api tools in ToolExecutor) over inventing new realm operation functions.** When a tool doesn't yet support the needed auth path (e.g., `boxel pull` lacks `--jwt`), use the shared lib as a stopgap and file a follow-up ticket.

## Implementation Backend Choice

### Option 1: Agent-Assisted Orchestration

The script performs bootstrap and loop setup, but the actual implementation still happens through the agent runtime.

Pros:

- smallest initial build
- matches the current system
- easiest to validate quickly

Cons:

- not a fully self-contained CLI runner

### Option 2: Scripted Local Mutations Only

The script itself creates and edits Boxel files without the agent.

Pros:

- deterministic
- easier to rerun

Cons:

- quickly turns into a brittle rule engine
- cannot generalize well from vague briefs

Recommendation:

Start with Option 1. Build a one-shot orchestrator that prepares state and makes the next action deterministic for the agent. Do not try to encode general product implementation logic in plain scripts yet.

## Agent Interface

The factory must be model-agnostic. The underlying LLM (Claude, GPT, Gemini, etc.) should be interchangeable without changing the orchestration logic.

### Routing Layer

The factory uses OpenRouter (`https://openrouter.ai/api/v1/chat/completions`) as its model routing layer. This is consistent with the existing Boxel host infrastructure, which already routes all LLM calls through OpenRouter via the realm server's `_request-forward` proxy.

Model identifiers follow the OpenRouter format: `<vendor>/<model-name>` (e.g., `anthropic/claude-sonnet-4.6`, `openai/gpt-4o`, `google/gemini-2.5-pro`).

### Configuration

The factory accepts model configuration through:

- `--model` CLI flag (e.g., `--model anthropic/claude-sonnet-4.6`)
- `FACTORY_LLM_MODEL` environment variable
- falls back to the Boxel default (`DEFAULT_CODING_LLM` from `runtime-common/matrix-constants.ts`)

For the first version, a single model handles all factory tasks. Later versions may use different models for different tasks (e.g., a cheaper model for test generation, a stronger model for implementation).

### `FactoryAgent` Interface

The orchestration loop communicates with the LLM through a `FactoryAgent` interface. This interface defines the contract between the deterministic orchestration code and the nondeterministic AI backend.

```typescript
interface FactoryAgentConfig {
  model: string; // OpenRouter model ID
  realmServerUrl: string; // for proxied API calls
  authorization?: string; // realm server JWT
}

interface AgentContext {
  project: ProjectCard; // current project state
  ticket: TicketCard; // active ticket
  knowledge: KnowledgeArticle[]; // relevant knowledge cards
  skills: ResolvedSkill[]; // active skills for this ticket (see Skills Integration)
  tools: ToolManifest[]; // available tools for this ticket (see Tools Integration)
  testResults?: TestResult; // previous test run output (if iterating)
  targetRealmUrl: string;
  testRealmUrl: string;
}

interface ResolvedSkill {
  name: string; // e.g., 'boxel-development'
  content: string; // full markdown content of the skill
  references?: string[]; // loaded reference file contents (for skills with references/)
}

// Every AgentAction is a tool call. The `type` field selects which tool
// the orchestrator executes. High-level action types like `create_file`
// are convenience aliases that the orchestrator maps to the underlying
// realm-api tool calls (e.g., `create_file` → `realm-write`).
// The agent can also use `invoke_tool` directly for any registered tool.

interface AgentAction {
  type:
    | 'create_file' // convenience: realm-write to target realm
    | 'update_file' // convenience: realm-write to target realm
    | 'create_test' // convenience: realm-write to test realm
    | 'update_test' // convenience: realm-write to test realm
    | 'update_ticket' // convenience: realm-write to update ticket card
    | 'create_knowledge' // convenience: realm-write to create/update knowledge card
    | 'invoke_tool' // invoke any registered tool directly
    | 'request_clarification' // signal: stop and ask the user
    | 'done'; // signal: ticket is complete
  path?: string; // realm-relative path for file actions
  content?: string; // file content or message
  realm?: 'target' | 'test'; // which realm the action targets
  tool?: string; // tool name for invoke_tool actions
  toolArgs?: Record<string, unknown>; // arguments for the tool
}

interface FactoryAgent {
  // Given context, produce the next set of actions for one implementation step.
  // The orchestrator calls this in a loop until the agent returns a 'done' action
  // or a 'request_clarification' action.
  plan(context: AgentContext): Promise<AgentAction[]>;
}
```

### How the Orchestrator Uses the Agent

The execution loop in `factory-loop.ts` drives the agent:

```
1.  orchestrator resolves skills for the current ticket (via SkillResolver)
2.  orchestrator loads resolved skills from .agents/skills/ (via SkillLoader)
3.  orchestrator builds tool manifest from registry (via ToolRegistry)
4.  orchestrator assembles AgentContext from realm state + skills + tools
5.  orchestrator calls agent.plan(context)
6.  agent returns AgentAction[] — each action is a tool call the orchestrator executes
7.  orchestrator validates each action against the tool registry and safety constraints
8.  orchestrator executes actions via the appropriate ToolExecutor, captures ToolResults
9.  orchestrator runs test harness against test realm
10. if tests fail:
    a. orchestrator reads test results
    b. orchestrator updates AgentContext with testResults + toolResults
    c. go to step 5
11. if tests pass:
    a. orchestrator saves test results in test realm
    b. orchestrator updates ticket status
    c. orchestrator moves to next ticket (skills + tools re-resolved)
```

The agent never directly produces side effects. Every `AgentAction` — whether it creates a file, writes a test, searches a realm, or calls a management API — is a tool call that the orchestrator validates and executes on the agent's behalf. Tool calls are the mechanism by which the orchestrator owns all side effects while still letting the agent decide what operations to perform.

### `FactoryAgent` Implementation

The first implementation wraps OpenRouter's chat completions API:

```typescript
class OpenRouterFactoryAgent implements FactoryAgent {
  constructor(private config: FactoryAgentConfig) {}

  async plan(context: AgentContext): Promise<AgentAction[]> {
    const messages = this.buildMessages(context);
    const response = await this.callOpenRouter(messages);
    return this.parseActions(response);
  }

  private async callOpenRouter(messages: Message[]): Promise<string> {
    // POST to https://openrouter.ai/api/v1/chat/completions
    // via realm server _request-forward proxy
    // model: this.config.model
    // Returns structured JSON response with actions
  }

  private buildMessages(context: AgentContext): Message[] {
    // Assembles the full prompt from templates + context.
    // See "Prompt Architecture" section below for the full structure.
  }

  private parseActions(response: string): AgentAction[] {
    // Parse and validate the structured JSON response
    // Reject actions that violate constraints (e.g., writing outside allowed realms)
  }
}
```

### Prompt Architecture

The agent interface communicates with the LLM through a structured prompt assembled from templates and runtime context. This section specifies how prompts are built, what the LLM sees at each stage of the loop, and how the output format is enforced.

#### Prompt Templates

Prompts are assembled from Markdown template files stored in `packages/software-factory/prompts/`. Templates use simple `{{variable}}` interpolation — no template engine dependency. The orchestrator reads these files at startup and caches them.

```
packages/software-factory/prompts/
├── system.md              # role, rules, and output schema
├── ticket-implement.md    # instructions for implementing a ticket
├── ticket-test.md         # instructions for generating tests
├── ticket-iterate.md      # instructions for fixing after test failure
├── action-schema.md       # AgentAction[] JSON schema reference
└── examples/
    ├── create-card.md     # example: creating a card definition + instance
    ├── create-test.md     # example: generating a test spec
    └── iterate-fix.md     # example: fixing code after test failure
```

Keeping prompts as standalone Markdown files (not embedded in TypeScript) means they can be iterated on without code changes, reviewed in PRs as prose, and tested with different models by swapping only the template text.

#### Message Structure

Each `plan()` call is a **one-shot LLM request**: one system message and one user message. The orchestrator assembles everything the agent needs into a single prompt. There is no multi-turn conversation — the agent is not having a dialogue with anyone. It receives a complete description of the current state and responds with actions.

```typescript
[
  { role: 'system', content: systemPrompt },
  { role: 'user', content: ticketPrompt },
];
```

The **system prompt** is the same for every call within a ticket: role definition, output schema, skills, and tools.

The **user prompt** changes depending on where the orchestrator is in the execution loop:

- **First pass** — uses `ticket-implement.md`: project context, knowledge articles, ticket description, and instructions to implement + write tests.
- **Iteration pass** — uses `ticket-iterate.md`: everything from the first pass, plus the actions the agent already took, the test results from the last run, and instructions to fix what failed.

Each call is self-contained. The orchestrator packs whatever history is relevant (previous actions, test output) into the single user message rather than replaying a growing conversation.

#### System Prompt

The system prompt is assembled once per ticket and stays constant across iterations. It defines who the agent is, what it can do, and how it must respond.

Template: `prompts/system.md`

```markdown
# Role

You are a software factory agent. You implement Boxel cards and tests in
target realms based on ticket descriptions and project context.

# Output Format

You must respond with a JSON array of actions. Each action matches this schema:

{{action-schema}}

Respond with ONLY the JSON array. No prose, no explanation, no markdown fences
around the JSON. The orchestrator parses your response as JSON directly.

# Rules

- Every ticket must include at least one `create_test` or `update_test` action.
- Test specs go in the test realm. Implementation goes in the target realm.
- Use `invoke_tool` to search for existing cards, check realm state, or run
  commands before creating files. Do not guess at existing state.
- If you cannot proceed, return a single `request_clarification` action
  explaining what is blocked.
- When all work for the ticket is complete and tests are passing, return a
  single `done` action.

# Realms

- Target realm: {{targetRealmUrl}}
- Test realm: {{testRealmUrl}}

# Skills

{{#each skills}}

## Skill: {{name}}

{{content}}

{{#each references}}

### Reference: {{referenceName}}

{{referenceContent}}
{{/each}}
{{/each}}

# Tools

You may invoke any of the following tools by returning an `invoke_tool` action.

{{#each tools}}

## Tool: {{name}}

{{description}}

Category: {{category}}
Output format: {{outputFormat}}

Arguments:
{{#each args}}

- {{name}} ({{type}}, {{#if required}}required{{else}}optional{{/if}}): {{description}}{{#if default}} (default: {{default}}){{/if}}
  {{/each}}
  {{/each}}
```

The `{{action-schema}}` variable is replaced with the contents of `prompts/action-schema.md`, which contains the full JSON schema for `AgentAction[]`. This is the canonical reference the LLM uses to produce valid output.

#### Ticket Implementation Prompt

Sent as the first user message when beginning work on a ticket.

Template: `prompts/ticket-implement.md`

```markdown
# Project

{{project.objective}}

Success criteria:
{{#each project.successCriteria}}

- {{this}}
  {{/each}}

# Knowledge

{{#each knowledge}}

## {{title}}

{{content}}
{{/each}}

# Current Ticket

ID: {{ticket.id}}
Summary: {{ticket.summary}}
Status: {{ticket.status}}
Priority: {{ticket.priority}}

Description:
{{ticket.description}}

{{#if ticket.checklist}}
Checklist:
{{#each ticket.checklist}}

- [ ] {{this}}
      {{/each}}
      {{/if}}

# Instructions

Implement this ticket. Return actions that:

1. Create or update card definitions (.gts) and/or card instances (.json) in the target realm
2. Create test specs (.spec.ts) in the test realm that verify your implementation
3. Use `invoke_tool` actions to inspect existing realm state before creating files

Start with the smallest working implementation, then add the test.
```

#### Test Generation Prompt

When the orchestrator wants the agent to generate tests separately from implementation (e.g., if the first pass only produced implementation files and no tests), it sends this as a follow-up.

Template: `prompts/ticket-test.md`

```markdown
# Test Generation

You implemented the following files for ticket {{ticket.id}}:

{{#each implementedFiles}}

## {{path}} ({{realm}} realm)
```

{{content}}

```
{{/each}}

Now generate Playwright test specs that verify this implementation.

Tests must:
- Live in the test realm as `TestSpec/{{ticket.slug}}.spec.ts`
- Import from the test fixtures and use the factory test harness
- Verify that card instances render correctly (fitted, isolated, embedded views)
- Verify card-specific behavior, field values, and relationships
- Be runnable by the `run-realm-tests` tool

Return only `create_test` actions.
```

#### Test Iteration Prompt

Sent as the user message after a test failure. This is a **self-contained one-shot prompt** — it includes everything the agent needs: the original ticket context, what was already tried, and the test results. The agent does not need to "remember" a prior conversation because all relevant history is in this single message.

Template: `prompts/ticket-iterate.md`

```markdown
# Project

{{project.objective}}

# Current Ticket

ID: {{ticket.id}}
Summary: {{ticket.summary}}
Description:
{{ticket.description}}

# Previous Attempt (iteration {{iteration}})

You previously produced the following actions for this ticket:

{{#each previousActions}}

## {{type}}: {{path}} ({{realm}} realm)
```

{{content}}

```
{{/each}}

# Test Results

The orchestrator applied your actions and ran tests. They failed.

Status: {{testResults.status}}
Passed: {{testResults.passed}}
Failed: {{testResults.failed}}
Duration: {{testResults.durationMs}}ms

{{#each testResults.failures}}
## Failure: {{testName}}

```

{{error}}

```

{{#if stackTrace}}
Stack trace:
```

{{stackTrace}}

````
{{/if}}
{{/each}}

{{#if toolResults}}
# Tool Results From Previous Iteration

{{#each toolResults}}
## {{tool}} (exit code: {{exitCode}})

```json
{{output}}
````

{{/each}}
{{/if}}

# Instructions

Fix the failing tests. You may:

- Update implementation files (use `update_file` actions)
- Update test specs (use `update_test` actions)
- Invoke tools to inspect current realm state
- If the test expectation is wrong, fix the test
- If the implementation is wrong, fix the implementation

Return the actions needed to make all tests pass.

```

#### One-Shot Iteration Flow

A single ticket may require multiple iterations. Each iteration is an independent one-shot call — the orchestrator packs everything into a single `[system, user]` message pair:

```

Pass 1 (initial implementation):
system: [system prompt with skills, tools, schema]
user: [ticket-implement — project context, ticket description]
→ LLM responds: AgentAction[] — creates files + tests
→ orchestrator applies actions, runs tests, tests fail

Pass 2 (first fix):
system: [same system prompt]
user: [ticket-iterate — ticket context + pass 1 actions + test failure output]
→ LLM responds: AgentAction[] — updates to fix failures
→ orchestrator applies actions, runs tests, tests fail again

Pass 3 (second fix):
system: [same system prompt]
user: [ticket-iterate — ticket context + pass 2 actions + new test failure output]
→ LLM responds: AgentAction[] — further fixes
→ orchestrator applies actions, runs tests, tests pass → ticket done

````

Each call is self-contained. The agent sees what it tried on the **previous** iteration (the actions and test results are in the user message), but it does not see the full history of all iterations. This keeps the prompt size bounded and each call independent.

If the orchestrator needs to give the agent more history (e.g., "you've tried this three times and keep making the same mistake"), it can include a summary of prior attempts in the `ticket-iterate` prompt. But the default is: show only the most recent attempt and its results.

#### Iteration Limits

- `maxIterations` (default: 5) — maximum fix attempts before the orchestrator marks the ticket as blocked
- since each call is one-shot, there is no growing conversation to truncate — the prompt size is naturally bounded by the ticket context + one iteration's worth of actions and test results

#### Output Parsing and Validation

The agent must respond with a raw JSON array of `AgentAction` objects. The orchestrator parses the response with these rules:

1. strip any markdown fences (` ```json ... ``` `) if present — some models add them despite instructions
2. parse the response as JSON
3. validate each action against the `AgentAction` schema:
   - `type` must be a known action type
   - file actions (`create_file`, `update_file`, `create_test`, `update_test`) must have `path`, `content`, and `realm`
   - `invoke_tool` actions must have `tool` matching a registered manifest and valid `toolArgs`
   - `realm` must be `'target'` or `'test'` — never anything else
4. reject the entire response if validation fails, log the raw response, and retry once with an error correction message:

```markdown
Your previous response was not valid JSON or contained invalid actions.

Parse error: {{parseError}}

Please respond with ONLY a valid JSON array of AgentAction objects.
````

If the retry also fails, the orchestrator marks the ticket as blocked.

#### Prompt File Location and Versioning

All prompt templates live in `packages/software-factory/prompts/`. They are versioned alongside the code in git. This means:

- prompt changes are reviewable in PRs
- prompts can be A/B tested by branching
- the `MockFactoryAgent` (for testing) can load the same templates to verify prompt assembly without calling an LLM

The orchestrator loads templates via a `PromptLoader`:

```typescript
interface PromptLoader {
  // Load a prompt template by name and interpolate variables.
  load(templateName: string, variables: Record<string, unknown>): string;
}
```

The loader reads from `prompts/`, caches the raw templates, and performs `{{variable}}` interpolation at call time. For `{{#each}}` blocks, it uses a minimal mustache-like expansion — no full template engine, just enough to iterate over arrays.

### Execution Log Persistence

Each one-shot LLM call and its results are valuable artifacts — they are the audit trail, the debugging surface, and the resume state. Rather than treating them as ephemeral in-memory data, the factory persists them as DarkFactory cards in the target realm.

#### `AgentExecutionLog` Card Type

A new card type added to the DarkFactory schema (`darkfactory-schema.gts`):

```typescript
class AgentExecutionLog extends CardDef {
  @field logId = contains(StringField); // stable ID: <ticket-slug>-log-<n>
  @field ticket = linksTo(Ticket); // which ticket this log is for
  @field model = contains(StringField); // OpenRouter model ID used
  @field status = contains(ExecutionStatusField); // running, completed, failed, blocked
  @field iterations = contains(MarkdownField); // serialized log of all one-shot calls (see below)
  @field iterationCount = contains(NumberField); // number of plan() calls made
  @field tokenUsage = contains(NumberField); // total tokens consumed across all calls
  @field startedAt = contains(DateTimeField);
  @field completedAt = contains(DateTimeField);
  @field errorSummary = contains(StringField); // if failed/blocked, why
}

// running → completed | failed | blocked
class ExecutionStatusField extends StringField {
  // Enum: running, completed, failed, blocked
}
```

#### Why a Card, Not a File

Persisting execution logs as DarkFactory cards (not raw JSON files) means:

- they are **queryable** — the agent can search for past logs by ticket, status, or model
- they are **renderable** — the DarkFactory UI can display the execution history alongside tickets and projects
- they are **linkable** — tickets link to their execution logs
- they are **resumable** — if the factory restarts, it can load the log card and know what was already tried
- they follow the same realm API patterns as all other factory artifacts

#### What Gets Persisted

Each `AgentExecutionLog` card captures every one-shot call made for a ticket's implementation attempt. The `iterations` field is a structured Markdown document:

```markdown
## Iteration 1

### Prompt

<the assembled user prompt sent to the LLM — ticket-implement>

### Response

<raw JSON AgentAction[] returned by the LLM>

### Actions Applied

- create_file: sticky-note.gts (target realm)
- create_test: TestSpec/define-sticky-note-core.spec.ts (test realm)

### Test Results

Status: failed
Passed: 0, Failed: 1
Error: "Cannot find module './sticky-note'"

---

## Iteration 2

### Prompt

<the assembled user prompt — ticket-iterate with previous actions + test failure>

### Response

<raw JSON AgentAction[] returned by the LLM>

### Actions Applied

- update_file: sticky-note.gts (target realm)

### Test Results

Status: passed
Passed: 1, Failed: 0
```

Each iteration records: what prompt was sent, what the LLM returned, what actions were applied, and what test results came back. This is a complete, self-contained log — since each call is one-shot, no "conversation" context is needed to make sense of individual entries.

#### When the Log Is Written

The orchestrator creates and updates `AgentExecutionLog` cards during the execution loop:

1. **On ticket start** — create a new `AgentExecutionLog` card with `status: running`, linked to the active ticket
2. **After each one-shot call** — append the iteration (prompt, response, actions, test results)
3. **On ticket completion** — set `status: completed`, record `completedAt`
4. **On failure/block** — set `status: failed` or `blocked`, record `errorSummary`

The card is written to the **target realm** (not the test realm), because it's a project artifact that tracks the implementation process — it belongs alongside the Project, Ticket, and KnowledgeArticle cards.

#### Execution Logs and Resume

When `factory:go --mode resume` runs:

1. the orchestrator finds the active ticket
2. it searches for an existing `AgentExecutionLog` card linked to that ticket with `status: running`
3. if found, it reads the last iteration to know what was already tried and what failed
4. it assembles the next one-shot `ticket-iterate` prompt with that context
5. the execution loop continues from where it left off

Since each call is one-shot, resume is straightforward — the orchestrator only needs the last iteration's actions and test results to construct the next prompt. There's no conversation state to reconstruct.

#### Execution Logs as Agent Context

Past logs are also useful as context for the agent. When starting work on a new ticket, the orchestrator can optionally include summaries of completed logs from related tickets in the `AgentContext.knowledge` field. This gives the agent awareness of what approaches worked (or didn't) on earlier tickets in the same project — without needing to replay any "conversation."

#### Relationship to Existing DarkFactory Cards

```
Project
├── Ticket (linksToMany)
│   ├── AgentExecutionLog (linked via ticket field)
│   │   ├── iterations (one-shot call log)
│   │   │   ├── prompt sent
│   │   │   ├── actions returned
│   │   │   └── test results
│   │   └── status (running/completed/failed/blocked)
│   ├── relatedKnowledge (linksToMany → KnowledgeArticle)
│   └── assignedAgent (linksTo → AgentProfile)
└── knowledgeBase (linksToMany → KnowledgeArticle)
```

The `AgentExecutionLog` card fills the gap between the Ticket (what needs to be done) and the test results in the test realm (what was verified). It captures _how_ the agent got from one to the other — the full sequence of one-shot calls, actions, and results.

### Swapping Models

Because the agent interface is model-agnostic:

- switching from Claude to GPT requires only changing the `--model` flag
- the system prompt and action schema stay the same
- the orchestrator behavior is identical regardless of model
- model-specific quirks (response format, token limits) are handled inside `OpenRouterFactoryAgent`, not in the orchestration loop
- prompt templates are designed to work across models — they use explicit JSON schema references rather than relying on model-specific features like tool-use APIs

### Future: Multiple Agent Backends

The `FactoryAgent` interface also supports non-OpenRouter backends:

- a `ClaudeCodeFactoryAgent` that delegates to Claude Code's tool-use loop
- a `LocalModelFactoryAgent` for self-hosted models via Ollama or vLLM
- a `MockFactoryAgent` for deterministic testing (the fake executor from the testing strategy)

The orchestrator does not care which backend is used. It only depends on the `FactoryAgent` interface. Each backend is responsible for translating the `AgentContext` into whatever prompt format its model expects — the prompt templates provide the canonical content, but a backend may restructure them (e.g., `ClaudeCodeFactoryAgent` might use native tool-use blocks instead of embedding tool manifests in the system prompt).

### Skills Integration

The factory has a library of skills in `.agents/skills/` that encode domain knowledge, best practices, and workflow patterns. These skills are the primary mechanism for giving the agent expertise about Boxel development, file structure conventions, Ember patterns, and factory operations. The agent interface must load and inject relevant skills into the LLM context so the agent produces correct, idiomatic output regardless of which model is used.

#### Available Skills

The factory currently has skills across several categories:

Boxel development skills:

- `boxel-development` — card definitions (`.gts`), card instances (`.json`), templates, styling, queries, commands. Includes a `references/` subdirectory with targeted guides for specific concerns (core concepts, template patterns, styling, theme design system, query systems, data management, etc.)
- `boxel-file-structure` — file naming conventions, module path rules, `adoptsFrom.module` resolution, `linksTo` vs `contains` distinction, JSON instance structure

Boxel CLI operations skills:

- `boxel-sync` — bidirectional sync strategies (`--prefer-local`, `--prefer-remote`, `--prefer-newest`)
- `boxel-track` — local file watching with automatic checkpoints
- `boxel-watch` — remote change monitoring
- `boxel-restore` — checkpoint restoration workflow
- `boxel-repair` — realm metadata and starter card repair
- `boxel-setup` — profile configuration and environment selection

Factory workflow skills:

- `software-factory-operations` — end-to-end delivery loop: search tickets, move to in_progress, implement, verify with Playwright, sync

Framework skills:

- `ember-best-practices` — 58 rules in 10 categories covering Ember.js performance, accessibility, and component patterns

#### Skill File Format

Each skill is a `SKILL.md` file with YAML frontmatter:

```yaml
---
name: boxel-development
description: For .gts card definitions, .json instances, templates, styling, queries, commands
---
# Skill content (markdown)
...
```

Some skills have additional structure:

- `references/` — subdirectory with targeted reference files loaded on demand (e.g., `boxel-development/references/dev-core-concept.md`)
- `rules/` — individual rule files with metadata (e.g., `ember-best-practices/rules/component-use-glimmer.md`)

#### Skill Resolution

The orchestrator resolves which skills to load based on the ticket's requirements. This happens in step 1 of the execution loop, when the orchestrator assembles `AgentContext`.

Resolution rules:

- `boxel-development` and `boxel-file-structure` are always loaded for tickets that involve creating or modifying card definitions or instances (the common case for factory work)
- `ember-best-practices` is loaded when the ticket involves `.gts` component code
- `software-factory-operations` is loaded for tickets that involve the factory's own delivery workflow
- CLI operation skills (`boxel-sync`, `boxel-track`, etc.) are loaded when the ticket involves realm synchronization or workspace management
- the project's `KnowledgeArticle` cards can specify additional skills to load via tags or explicit references

For the first version, the orchestrator can use a simple tag-based matcher:

```typescript
interface SkillResolver {
  // Given a ticket and project context, return the list of skill names to load.
  resolve(ticket: TicketCard, project: ProjectCard): string[];
}
```

A default implementation loads `boxel-development` + `boxel-file-structure` for all Boxel card work, plus `ember-best-practices` when `.gts` files are involved. This covers the majority of factory tickets.

#### Skill Loading

The orchestrator reads skill files from disk at startup and caches them for the duration of the run:

```typescript
interface SkillLoader {
  // Load a skill by name from the .agents/skills/ directory.
  // Returns the SKILL.md content plus any references/ files.
  load(skillName: string): Promise<ResolvedSkill>;

  // Load all skills matching the resolved names.
  loadAll(skillNames: string[]): Promise<ResolvedSkill[]>;
}
```

Loading behavior:

- reads `SKILL.md` from the skill directory
- for skills with a `references/` subdirectory (like `boxel-development`), loads targeted reference files based on the ticket context rather than all references at once — this keeps the LLM context focused
- for skills with a `rules/` directory (like `ember-best-practices`), loads the compiled `AGENTS.md` rather than individual rule files
- skill content is included as-is in the agent's context — the markdown format is already designed to be LLM-readable

#### How Skills Enter the LLM Context

The `OpenRouterFactoryAgent.buildMessages()` method assembles the LLM prompt from the `AgentContext`. Skills are injected as part of the system message:

```
System prompt structure:
1. Role definition and output format (AgentAction[] schema)
2. Active skills (one section per resolved skill)
3. Project context (project card, knowledge articles)
4. Current ticket (description, acceptance criteria, checklist)
5. Previous test results (if iterating after failure)
```

Each skill becomes a labeled section in the system prompt:

```
## Skill: boxel-development

<content of SKILL.md>

### Reference: dev-core-concept

<content of references/dev-core-concept.md>

## Skill: boxel-file-structure

<content of SKILL.md>
```

This ensures the agent has the domain knowledge it needs to produce correct card definitions, follow naming conventions, and apply best practices — regardless of whether the underlying model is Claude, GPT, Gemini, or a local model.

#### Skill Context Budget

Skills can be large (e.g., `boxel-development` with all its references is substantial). The orchestrator should manage the skill context budget:

- prioritize skills by relevance to the current ticket
- for skills with `references/`, load only the references relevant to the ticket (e.g., load `dev-styling-design.md` only if the ticket involves styling)
- if total skill content exceeds a configurable token budget, drop lower-priority skills and log a warning
- the `FactoryAgentConfig` should include an optional `maxSkillTokens` field

```typescript
interface FactoryAgentConfig {
  model: string;
  realmServerUrl: string;
  authorization?: string;
  maxSkillTokens?: number; // optional cap on skill context size
}
```

#### Adding New Skills

The skill system is file-based and extensible. To add a new skill:

1. create a directory under `.agents/skills/<skill-name>/`
2. add a `SKILL.md` with YAML frontmatter (`name`, `description`) and markdown content
3. optionally add `references/` for targeted sub-documents
4. update the skill resolver's tag mapping so the orchestrator knows when to load it

No registration API, no manifest file — the skill directory structure is the registry. This keeps the system simple and lets skills be developed independently of the orchestration code.

### Tools Integration

Skills give the agent knowledge. Tools give the agent capabilities. The factory has two categories of tools that the agent can invoke through the orchestrator: **scripts** (standalone CLI tools in `packages/software-factory/scripts/`) and **boxel-cli commands** (the `boxel` CLI installed as a dependency).

The agent does not execute tools directly. Instead, it returns `invoke_tool` actions that the orchestrator validates and executes on the agent's behalf, returning the tool output as context for the next `plan()` call.

#### Tool Manifest

Each tool is described by a manifest that the orchestrator includes in the `AgentContext`. The manifest tells the LLM what tools are available, what they do, and what arguments they accept.

```typescript
interface ToolManifest {
  name: string; // unique tool identifier
  description: string; // what the tool does (LLM-readable)
  category: 'script' | 'boxel-cli' | 'realm-api';
  args: ToolArg[]; // expected arguments
  outputFormat: 'json' | 'text'; // what the tool returns
}

interface ToolArg {
  name: string; // argument name (e.g., 'realm', 'status')
  description: string; // what the argument controls
  required: boolean;
  type: 'string' | 'number' | 'boolean';
  default?: string; // default value if not provided
}

interface ToolResult {
  tool: string; // tool name that was invoked
  exitCode: number; // 0 = success
  output: unknown; // parsed JSON or raw text
  durationMs: number;
}
```

#### Available Script Tools

These are the standalone scripts in `packages/software-factory/scripts/` that the agent can invoke. They all output structured JSON and use the shared auth library (`scripts/lib/boxel.ts`).

##### `search-realm`

Search for cards in a realm by type, field values, and sort criteria.

- **Script**: `scripts/boxel-search.ts`
- **Args**:
  - `--realm <url>` (required) — target realm URL
  - `--type-name <name>` — filter by card type name
  - `--type-module <module>` — filter by card type module
  - `--eq field=value` (repeatable) — equality filters
  - `--contains field=value` (repeatable) — contains filters
  - `--sort field:direction` (repeatable) — sort criteria
  - `--size <number>` — page size
  - `--page <number>` — page number
- **Output**: JSON with search results (`data` array of card metadata)
- **Use by agent**: finding existing cards, checking for duplicates, querying project state

##### `pick-ticket`

Find tickets by status, priority, project, or assigned agent.

- **Script**: `scripts/pick-ticket.ts`
- **Args**:
  - `--realm <url>` (required) — target realm URL
  - `--status <statuses>` — comma-separated status filter (default: `backlog,in_progress,review`)
  - `--project <id>` — filter by project
  - `--agent <id>` — filter by assigned agent
  - `--module <url>` — ticket schema module URL
- **Output**: JSON with ticket count and compact ticket objects
- **Use by agent**: finding the next ticket to work on, checking ticket states

##### `get-session`

Generate authenticated browser session tokens for realm access.

- **Script**: `scripts/boxel-session.ts`
- **Args**:
  - `--realm <url>` (optional, repeatable) — specific realms to include
- **Output**: JSON with auth credentials and realm session tokens
- **Use by agent**: obtaining auth for realm API calls

##### `run-realm-tests`

Execute Playwright tests in an isolated scratch realm with fixture setup and teardown.

- **Script**: `scripts/run-realm-tests.ts`
- **Args**:
  - `--realm-path <dir>` — source realm directory
  - `--realm-url <url>` — source realm URL
  - `--spec-dir <dir>` — test directory (default: `tests`)
  - `--fixtures-dir <dir>` — fixtures directory (default: `tests/fixtures`)
  - `--endpoint <name>` — realm endpoint name
  - `--scratch-root <dir>` — base dir for test realms
- **Output**: JSON with test stats (pass/fail counts, failures with details)
- **Use by agent**: running AI-generated tests, getting structured test failure output

#### Available Boxel CLI Tools

The `boxel` CLI (installed as a dependency, invoked via `npx boxel`) provides workspace management commands. These are relevant when the agent needs to interact with realms beyond simple HTTP API calls.

##### `boxel sync`

Bidirectional sync between local workspace and realm server.

- **Command**: `npx boxel sync <path> [--prefer-local|--prefer-remote|--prefer-newest] [--dry-run]`
- **Use by agent**: pushing implementation artifacts to the target realm, pulling current state

##### `boxel push`

One-way upload from local to realm.

- **Command**: `npx boxel push <local-dir> <realm-url> [--delete] [--dry-run]`
- **Use by agent**: deploying generated files to target or test realm

##### `boxel pull`

One-way download from realm to local.

- **Command**: `npx boxel pull <realm-url> <local-dir> [--delete] [--dry-run]`
- **Use by agent**: fetching current realm state before implementation

##### `boxel status`

Check sync status of a workspace.

- **Command**: `npx boxel status <path> [--all] [--pull]`
- **Use by agent**: verifying realm state before and after operations

##### `boxel create`

Create a new workspace/realm endpoint.

- **Command**: `npx boxel create <endpoint> <name>`
- **Use by agent**: creating scratch realms for test execution

##### `boxel history`

View or create checkpoints.

- **Command**: `npx boxel history <path> [-m "message"]`
- **Use by agent**: creating checkpoints before destructive operations

#### Available Realm Server APIs

The realm server exposes HTTP endpoints that the agent can invoke directly through `invoke_tool` actions with `category: 'realm-api'`. Rather than hardcoding specific API calls in the orchestrator, the plan is to expose the full range of realm server capabilities as tools the agent can use. This means operations like realm creation, card CRUD, search, and batch mutations are all available to the agent — the orchestrator validates and executes them, but the agent decides when and how to use them.

This is an important design principle: **any Boxel API call that the orchestrator might make on behalf of the agent should also be expressible as a tool the agent can invoke directly**. The orchestrator still owns safety constraints and execution, but the agent has the vocabulary to request any realm operation it needs.

##### Card and File Operations

###### `realm-read`

Fetch a card or file from a realm.

- **Endpoint**: `GET <realm-url>/<path>`
- **Headers**: `Accept: application/vnd.card+source` or `application/vnd.api+json`
- **Use by agent**: reading existing card definitions, inspecting current state

###### `realm-write`

Create or update a card or file in a realm.

- **Endpoint**: `POST <realm-url>/<path>`
- **Headers**: `Content-Type: application/vnd.card+source` or `application/vnd.api+json`
- **Use by agent**: writing card definitions (`.gts`) and card instances (`.json`)

###### `realm-delete`

Delete a card or file from a realm.

- **Endpoint**: `DELETE <realm-url>/<path>`
- **Use by agent**: removing outdated artifacts

###### `realm-atomic`

Batch operations that succeed or fail atomically.

- **Endpoint**: `POST <realm-url>/_atomic`
- **Body**: `{ "atomic:operations": [{ "op": "add"|"update"|"remove", "href": "...", "data": {...} }] }`
- **Use by agent**: creating multiple related files in a single transaction (e.g., card definition + instances)

##### Query Operations

###### `realm-search`

Search for cards using structured queries.

- **Endpoint**: `QUERY <realm-url>/_search`
- **Use by agent**: finding existing cards, checking for duplicates, querying project state

###### `realm-mtimes`

Get file modification times for a realm.

- **Endpoint**: `GET <realm-url>/_mtimes`
- **Use by agent**: checking what files exist in a realm, detecting changes

##### Realm Management Operations

###### `realm-create`

Create a new realm on the realm server.

- **Endpoint**: `POST <realm-server-url>/_create-realm`
- **Auth**: realm server JWT (from `_server-session`)
- **Use by agent**: creating scratch realms for experimentation, creating additional test realms, bootstrapping new workspaces

###### `realm-server-session`

Obtain a realm server JWT for management operations.

- **Endpoint**: `POST <realm-server-url>/_server-session`
- **Use by agent**: obtaining auth for realm management APIs that require server-level tokens

###### `realm-reindex`

Trigger a full reindex of a realm.

- **Endpoint**: `POST <realm-url>/_reindex`
- **Use by agent**: forcing the realm server to re-process card definitions after updates

##### Design Principle: APIs as Tools

The boundary between "what the orchestrator does directly" and "what the agent invokes as a tool" is intentionally flexible. In Phase 2 (Target Realm Preparation), the orchestrator calls `/_create-realm` directly because realm creation is a deterministic prerequisite. But during Phase 4 (Execution Loop), the agent might invoke `realm-create` as a tool to spin up a scratch realm for an experiment, or `realm-atomic` to write multiple cards at once.

The rule is: **if the orchestrator hardcodes an API call today, it should also be registered as a tool so the agent can invoke the same operation when the situation calls for it**. Over time, more of the deterministic orchestrator steps may migrate to being agent-driven, with the orchestrator only handling safety validation and execution.

#### How the Orchestrator Exposes Tools to the Agent

The orchestrator builds the `ToolManifest[]` list at startup and includes it in every `AgentContext`. The manifests are injected into the LLM prompt alongside skills:

```
System prompt structure:
1. Role definition and output format (AgentAction[] schema)
2. Active skills (domain knowledge)
3. Available tools (capability manifests with argument schemas)
4. Project context (project card, knowledge articles)
5. Current ticket (description, acceptance criteria, checklist)
6. Previous tool results / test results (if iterating)
```

Each tool manifest becomes a structured section:

```
## Tool: search-realm

Search for cards in a realm by type, field values, and sort criteria.

Category: script
Output: json

Arguments:
- realm (string, required): target realm URL
- type-name (string, optional): filter by card type name
- eq (string, optional, repeatable): equality filter as "field=value"
- sort (string, optional, repeatable): sort as "field:direction"

## Tool: boxel-sync

Bidirectional sync between local workspace and realm server.

Category: boxel-cli
Output: text

Arguments:
- path (string, required): local workspace path
- prefer (string, optional): conflict strategy — "local", "remote", or "newest"
- dry-run (boolean, optional): preview only, no changes
```

#### How the Orchestrator Executes Tool Invocations

When the agent returns an `invoke_tool` action, the orchestrator:

1. validates the tool name against the registered manifest
2. validates the arguments against the manifest's arg schema
3. rejects tools or arguments that violate safety constraints (e.g., `--delete` on a non-scratch realm)
4. executes the tool as a subprocess (for scripts and CLI commands) or HTTP request (for realm APIs)
5. captures the output as a `ToolResult`
6. includes the `ToolResult` in the next `AgentContext` so the agent can use the output

```typescript
interface ToolExecutor {
  // Execute a validated tool invocation and return the result.
  execute(action: AgentAction): Promise<ToolResult>;
}

class ScriptToolExecutor implements ToolExecutor {
  // Runs: ts-node --transpileOnly scripts/<script>.ts <args>
  // Captures stdout as JSON
}

class BoxelCliToolExecutor implements ToolExecutor {
  // Runs: npx boxel <command> <args>
  // Captures stdout as text
}

class RealmApiToolExecutor implements ToolExecutor {
  // Makes authenticated HTTP request to realm server
  // Returns response body as JSON
}
```

#### Tool Safety

The orchestrator enforces safety constraints on tool invocations:

- tools can only target the target realm, test realm, or scratch realms — never the source realm
- destructive operations (`--delete`, `realm-delete`, `realm-atomic` with `remove` ops) require the orchestrator to verify the target is a factory-managed realm
- the agent cannot invoke arbitrary shell commands — only registered tools
- tool execution has a configurable timeout (default: 60 seconds per invocation)
- the orchestrator logs all tool invocations for auditability

#### Adding New Tools

To make a new script available as a tool:

1. create the script in `packages/software-factory/scripts/` following the existing pattern (structured JSON output, argument parsing via `parseArgs`)
2. register it in the tool manifest registry (a static list in `factory-tool-registry.ts`)
3. the manifest describes the tool's name, arguments, and output format — this is what the LLM sees

To expose a new boxel-cli command:

1. ensure the command exists in the installed `boxel` CLI
2. add a manifest entry in the tool registry with `category: 'boxel-cli'`

To expose a new realm server API:

1. add a manifest entry with `category: 'realm-api'`
2. implement the HTTP call pattern in `RealmApiToolExecutor`

## First-Version Execution Contract

The first version of `factory:go` should do exactly this:

1. fetch the brief
2. ensure the target realm exists
3. create the companion test realm
4. create or reconcile starter project artifacts
5. select the first actionable ticket
6. print a structured execution bundle for the agent or next stage

If run in `--mode implement`, it should then:

7. open the active ticket context
8. perform one implementation cycle
9. generate tests in the test realm for the implemented work
10. execute tests via the test harness
11. if tests fail, feed results back to the agent and return to step 8
12. on test success, save results in the test realm and update ticket state

It does not need to complete an entire multi-ticket product in version one. But it must complete the full implement → test → iterate cycle for at least one ticket.

## File Changes For Minimal Version

Files to add:

- `packages/software-factory/scripts/factory-go.ts`
- `packages/software-factory/scripts/lib/factory-bootstrap.ts`
- `packages/software-factory/scripts/lib/factory-target-realm.ts`
- `packages/software-factory/scripts/lib/factory-brief.ts`
- `packages/software-factory/scripts/lib/factory-loop.ts`
- `packages/software-factory/scripts/lib/factory-test-realm.ts`
- `packages/software-factory/scripts/lib/factory-agent.ts`
- `packages/software-factory/scripts/lib/factory-skill-loader.ts`
- `packages/software-factory/scripts/lib/factory-tool-registry.ts`
- `packages/software-factory/scripts/lib/factory-tool-executor.ts`
- `packages/software-factory/scripts/lib/factory-prompt-loader.ts`
- `packages/software-factory/prompts/system.md`
- `packages/software-factory/prompts/ticket-implement.md`
- `packages/software-factory/prompts/ticket-test.md`
- `packages/software-factory/prompts/ticket-iterate.md`
- `packages/software-factory/prompts/action-schema.md`
- `packages/software-factory/prompts/examples/create-card.md`
- `packages/software-factory/prompts/examples/create-test.md`
- `packages/software-factory/prompts/examples/iterate-fix.md`

Files to update:

- `packages/software-factory/package.json`
  - add `factory:go`
- `packages/software-factory/AGENTS.md`
  - document the new one-shot flow

Optional later additions:

- `packages/software-factory/tests/factory-go.spec.ts`
  - verifies bootstrap behavior
- enhanced test generation templates for common card patterns (fitted view, isolated view, field rendering)

## Suggested Output Contract

`factory:go` should emit machine-readable JSON at the end. Example shape:

```json
{
  "brief": {
    "url": "http://localhost:4201/software-factory/Wiki/sticky-note",
    "title": "Sticky Note",
    "contentSummary": "Colorful, short-form note designed for spatial arrangement on boards and artboards.",
    "tags": ["documents-content", "sticky", "note"]
  },
  "targetRealm": {
    "url": "http://localhost:4201/hassan1/personal/"
  },
  "testRealm": {
    "url": "http://localhost:4201/hassan1/personal-tests/"
  },
  "bootstrap": {
    "createdProject": "Project/sticky-note-mvp",
    "createdTickets": [
      "Ticket/define-sticky-note-core",
      "Ticket/design-board-ready-views",
      "Ticket/add-linking-and-automation"
    ]
  },
  "activeTicket": {
    "id": "Ticket/define-sticky-note-core",
    "status": "in_progress"
  },
  "verification": {
    "strategy": "test-realm",
    "testRealmUrl": "http://localhost:4201/hassan1/personal-tests/"
  }
}
```

This keeps the process inspectable and resumable.

Brief intake should not assume public realm access.

- `factory:go` should fetch the brief with `Accept: application/vnd.card+source`
- when the brief URL is on the active Boxel realm-server origin, the CLI should try to resolve a realm JWT from the active Boxel profile before fetching
- the CLI should rely on profile or Matrix environment auth rather than a separate explicit brief-token flag

## Acceptance Criteria For The First `factory:go`

- a user can point to a brief URL and a target realm URL
- the target realm ends up with a coherent project bootstrap
- a companion test realm is created alongside the target realm
- exactly one ticket becomes active
- rerunning does not create duplicate starter artifacts
- the flow can proceed directly into implementation work
- the brief normalization output gives the AI enough context to choose thin-MVP vs broader-first-pass planning and request clarification or review tickets when needed
- in `--mode implement`, the agent generates at least one test per ticket in the test realm
- test execution results are saved as structured artifacts in the test realm
- failed test output is fed back to the agent, driving an implement-verify loop until tests pass

## Recommended Delivery Order

1. add target realm bootstrap helpers (including test realm creation)
2. add brief fetch and normalization
3. add idempotent project artifact bootstrap
4. expose `factory:go`
5. add test realm management and AI test generation module
6. add one-ticket implementation mode with implement → test → iterate loop
7. add stronger resume behavior

## Practical Conclusion

The missing piece is orchestration, not capability. The current project already has enough primitives to support a one-shot flow, but only after adding:

- a formal entrypoint
- deterministic bootstrap rules
- target realm preparation
- a companion test realm for AI-generated tests
- a test generation and execution loop that feeds results back to the agent
- a minimal implementation loop that requires passing tests before advancing

The test realm is central to the quality feedback loop. The agent writes code in the target realm, writes tests in the test realm, runs them via the test harness, and iterates until they pass. Test artifacts in the test realm serve as durable proof of verification and as the primary signal driving the agentic loop.

That is the smallest path to turning the current software-factory idea into something that feels like:

“Point at a brief, say go, and watch it enter the delivery loop.”

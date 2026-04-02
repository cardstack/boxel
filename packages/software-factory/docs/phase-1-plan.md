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

The execution loop uses an **executable tool functions** model. Instead of the agent returning a declarative `AgentAction[]` array that the orchestrator interprets, the agent is given callable tool functions and invokes them directly during its turn, seeing results inline. This gives the agent read-then-act capability within a single LLM session.

Required behavior:

1. pick the active or next available ticket
2. resolve skills for the current ticket via `SkillResolver`
3. load skills from `.agents/skills/` via `SkillLoader`
4. build executable tool functions (wrapping realm operations, scripts, and signals with auth + safety middleware)
5. assemble `AgentContext` (project, ticket, knowledge, skills, test results)
6. call `agent.run(context, tools)` — agent calls tools during its turn, seeing results inline
7. inspect `AgentRunResult` — if `needs_iteration` (tests failed), update context with test results and go to step 6
8. if `done` — save results, update ticket status, advance to next ticket
9. if `blocked` — record clarification, stop
10. `maxIterations` (default: 5) prevents infinite loops

#### Concrete Data Flow Per Iteration

The agent is given tool functions and calls them directly during its LLM turn. The orchestrator mediates each tool call (validate, execute, return result), but the agent drives the flow.

```
1. Orchestrator builds tool functions and calls agent.run(context, tools)

2. Agent calls tools during its turn, seeing results inline:
   Agent: search_realm({ realm: targetRealmUrl, type_name: "StickyNote" })
   → Tool returns: { data: [] }  (no existing StickyNote)

   Agent: write_file({ path: "sticky-note.gts", content: "import { CardDef, ... } ...", realm: "target" })
   → Tool returns: { ok: true }

   Agent: write_file({ path: "StickyNote/welcome-note.json", content: "{ \"data\": { ... } }", realm: "target" })
   → Tool returns: { ok: true }

   Agent: write_file({ path: "Spec/sticky-note.json", content: "{ \"data\": { ... } }", realm: "target" })
   → Tool returns: { ok: true }

   Agent: write_file({ path: "Tests/sticky-note.spec.ts", content: "import { test, expect } ...", realm: "target" })
   → Tool returns: { ok: true }

   Agent: signal_done()
   → Session ends

3. Each tool call goes through safety middleware:
   - write_file writes raw content to the realm via card+source MIME type (path must include extension)
   - realm selection: tool arg realm === 'test' → testRealmUrl, else → targetRealmUrl
   - auth: per-realm JWT from realmTokens[realmUrl]

4. After agent signals done, orchestrator runs tests:
   executeTestRunFromRealm({ targetRealmUrl, specPaths, ... })

5. If tests fail: orchestrator reads TestRun card for failure details,
   builds TestResult, feeds into AgentContext.testResults,
   and calls agent.run() again — the agent can read its previous
   writes and test failures to self-correct.
```

The agent calls tools directly via the LLM's native tool-use protocol. Each tool implementation enforces safety constraints (realm protection, auth, logging) before executing. The orchestrator still owns test execution as a separate phase after the agent finishes its turn.

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

Each tool's `execute` function looks up the correct per-realm JWT based on which realm the operation targets.

#### Tool Availability

Boxel-cli tools (`boxel-sync`, `boxel-push`, `boxel-pull`, etc.) are excluded from the agent's tool registry until CS-10520 lands (boxel-cli auth integration). The `ToolRegistry` is constructed with only `SCRIPT_TOOLS` and `REALM_API_TOOLS`. All file operations use the realm HTTP API directly.

Test generation rule:

- the agent must produce at least one Playwright test file per ticket before a ticket can be marked as done
- Playwright test files live in the target realm's `Tests/` folder (e.g., `Tests/<ticket-slug>.spec.ts`)
- test artifacts include both the Playwright test source code and the structured test execution results (TestRun cards)
- failed test output is the primary feedback signal that drives the implement-verify loop

### Phase 5: Verification

> **Note (CS-10451 cancelled):** The dedicated verification policy ticket (CS-10451) was cancelled because hard-coding a verification gate in the orchestrator conflicts with the phase-2 direction (`phase-2-plan.md`). In phase 2, test execution is modeled as an issue type — the agent creates test issues during task breakdown, and the orchestrator treats them like any other issue. A hard-coded "must have tests" gate would need to be removed when phase 2 lands. For phase 1, the orchestrator runs tests after the agent signals done (orchestrator-owned test execution in `factory-loop.ts`), but enforcement of "at least one test per ticket" is left to the agent's prompt and skills rather than orchestrator code.

Verification is mandatory. Every ticket must have AI-generated Playwright test files before it can be marked done.

Test generation policy:

- the agent creates Playwright test files in the target realm's `Tests/` folder that exercise the cards and behavior implemented for the current ticket
- for Boxel card work, tests should at minimum verify that card instances render correctly in fitted, isolated, and embedded views
- additional tests should cover card-specific behavior, field values, relationships, and interactions
- the agent should start with the smallest meaningful test and expand coverage if the first test passes trivially

Test execution policy:

- the orchestrator owns test execution — the agent writes test files via `write_file` tool calls, and the orchestrator triggers test execution as a separate phase after the agent finishes its turn
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

### 5. Default Verification Policy _(deferred — see CS-10451 cancellation note)_

~~The first verification move should be encoded so the runner knows what to do when there are no tests yet.~~

For phase 1, verification is handled by the orchestrator running tests after the agent signals done. Enforcement of "at least one test" is prompt-driven, not code-enforced. Phase 2 replaces this with test execution as an issue type.

### 6. Execution Policy

The current behavior is described in prose, but not encoded as a decision engine. The one-shot flow needs explicit answers to:

- when to keep implementing
- when to create new tickets
- when to capture knowledge
- when to ask the user a question

### 7. Long-Running Operations

With executable tool functions, the agent handles sequential tool calls naturally — it calls tools in order, sees results, and reacts. However, the execution loop still involves long-running operations like test execution (~10 minutes per run) that require special handling:

1. Write test spec to the target realm `Tests/` folder (via `write_file`)
2. Write a `TestRun` card to the target realm `Test Runs/` folder (via `write_file`)
3. Execute tests against the target realm (via `run-realm-tests`); any data created during execution is stored in the test artifacts realm
4. Parse and save test results back to the `TestRun` card in the target realm
5. Feed results back to the agent for the next iteration

With executable tool functions, the agent naturally sequences its operations — it calls `write_file` for implementation, then `write_file` for tests, then `signal_done`. The orchestrator triggers test execution as a separate phase after the agent finishes its turn. The agent could also call `run_tests` directly as a tool, but the orchestrator owns the post-turn verification step to ensure tests always run.

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

### E. `scripts/lib/factory-loop.ts` _(implemented — CS-10568)_

Central execution loop orchestrator. Exports `runFactoryLoop()` which drives the implement→test→iterate cycle for a single ticket.

#### Key Types

- **`LoopAgent`** — interface with `run(context: AgentContext, tools: FactoryTool[]): Promise<AgentRunResult>`. The agent calls tools directly during its turn via the LLM's native tool-use protocol, rather than returning a declarative `AgentAction[]` array.
- **`AgentRunResult`** — `{ status: 'done' | 'blocked' | 'needs_iteration', toolCalls: ToolCallEntry[], message?: string }`. Replaces the old `AgentAction[]` return type.
- **`FactoryLoopResult`** — `{ outcome: 'tests_passed' | 'done' | 'max_iterations' | 'clarification_needed', iterations, toolCallLog, testResults?, message? }`.
- **`ContextBuilderLike`** — interface matching `ContextBuilder.build()` signature, defined here to avoid circular dependency on the concrete class.
- **`TestRunner`** — `() => Promise<TestResult>` callback injected by the caller, decoupling the loop from Playwright specifics.

#### Loop Flow

1. Build `AgentContext` via `ContextBuilder` (includes test results from prior iteration if any)
2. Call `agent.run(context, tools)` — agent calls tools during its turn
3. Inspect `AgentRunResult`:
   - `blocked` → return `clarification_needed`
   - `needs_iteration` → loop back to step 1 (enables read-only exploration rounds)
   - `done` with no tool calls → return `done` (unless prior tests failed, in which case return `max_iterations`)
   - `done` with tool calls → run `TestRunner`
4. If tests pass → return `tests_passed`
5. If tests fail → update `testResults`, loop back to step 1
6. `maxIterations` guard (default: 5, validated as positive integer) prevents infinite loops

#### Implementation Notes from CS-10568

- **Orchestrator-owned test execution**: the agent signals done, the orchestrator triggers tests as a separate phase. All tool calls (writes) complete before test execution begins.
- **`needs_iteration` status**: enables multi-turn agent rounds where the agent does read-only exploration (search, read) before committing writes. The loop counts this as an iteration but does not run tests.
- **Bare done guard**: if the agent signals done with no tool calls but prior tests failed, the loop returns `max_iterations` with the failing test results preserved — prevents silently dropping failures.
- **Tool call log**: all `ToolCallEntry[]` from every iteration are accumulated in `toolCallLog` on the result, providing a complete audit trail.
- **No conversation state**: each `run()` call is independent. Context threading happens via `AgentContext.testResults` — the orchestrator passes failing test results back so the agent can self-correct.

#### What This Module Does NOT Own

- Ticket selection (caller picks the ticket)
- Skill resolution/loading (delegated to `ContextBuilder`)
- Tool building (caller provides `FactoryTool[]`)
- Test execution details (caller provides `TestRunner` callback)
- Ticket status updates (caller inspects result and updates)

For the first version, this does not need to be a general autonomous system. It only needs to perform one ticket deeply and leave the realm in a coherent state. However, it must complete the full implement → test → iterate cycle before marking a ticket done.

### F. `scripts/lib/factory-test-realm.ts`

Helper module for managing test execution and results in the test realm.

#### Key Design Decisions

- **Test spec writing uses `write_file` tool calls** — no special mechanism. The agent writes test files to the target realm's `Tests/` folder via the same `write_file` tool used for implementation files.
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

The orchestration loop communicates with the LLM through a `FactoryAgent` interface. Instead of returning a declarative action array, the agent is given executable tool functions and calls them directly during its turn via the LLM's native tool-use protocol.

```typescript
interface FactoryAgentConfig {
  model: string; // OpenRouter model ID
  realmServerUrl: string; // for proxied API calls
  authorization?: string; // realm server JWT
  maxSkillTokens?: number; // optional cap on skill context size
}

interface AgentContext {
  project: ProjectCard; // current project state
  ticket: TicketCard; // active ticket
  knowledge: KnowledgeArticle[]; // relevant knowledge cards
  skills: ResolvedSkill[]; // active skills for this ticket (see Skills Integration)
  testResults?: TestResult; // previous test run output (if iterating)
  targetRealmUrl: string;
  testRealmUrl: string;
}

interface ResolvedSkill {
  name: string; // e.g., 'boxel-development'
  content: string; // full markdown content of the skill
  references?: string[]; // loaded reference file contents (for skills with references/)
}

// Tool functions are provided to the agent at runtime. Each tool has a
// JSON Schema definition (for the LLM) and an execute function (for the
// orchestrator to run when the LLM calls it).

interface FactoryTool {
  name: string; // unique tool identifier
  description: string; // what the tool does (LLM-readable)
  parameters: Record<string, unknown>; // JSON Schema for the tool's input
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

interface AgentRunResult {
  status: 'done' | 'blocked' | 'needs_iteration';
  clarification?: string; // set when status === 'blocked'
  toolCallLog: ToolCallEntry[]; // all tool calls made during this run
}

interface ToolCallEntry {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  durationMs: number;
}

interface FactoryAgent {
  // Run the agent with the given context and tools. The agent calls tools
  // during its turn via native tool-use, seeing results inline. Returns
  // when the agent signals done, blocked, or the orchestrator intervenes.
  run(context: AgentContext, tools: FactoryTool[]): Promise<AgentRunResult>;
}
```

### How the Orchestrator Uses the Agent

The execution loop in `factory-loop.ts` drives the agent:

```
1.  orchestrator resolves skills for the current ticket (via SkillResolver)
2.  orchestrator loads resolved skills from .agents/skills/ (via SkillLoader)
3.  orchestrator builds executable tool functions:
    - write_file, read_file, search_realm (realm operations wrapped with auth + safety)
    - update_ticket, create_knowledge (card writes to target realm)
    - run_tests (triggers test execution, returns results)
    - signal_done, request_clarification (control flow signals)
    - plus all registered script/realm-api tools
4.  orchestrator assembles AgentContext from realm state + skills
5.  orchestrator calls agent.run(context, tools)
6.  agent calls tools during its turn — each call goes through safety middleware:
    a. validate inputs
    b. enforce realm targeting (never the source realm)
    c. execute the operation
    d. return result to the agent inline
7.  agent signals done or blocked, run() returns AgentRunResult
8.  orchestrator triggers test execution (after agent finishes)
9.  if tests fail:
    a. orchestrator reads test results
    b. orchestrator updates AgentContext with testResults
    c. go to step 5
10. if tests pass:
    a. orchestrator saves test results
    b. orchestrator updates ticket status
    c. orchestrator moves to next ticket (skills + tools re-resolved)
```

The agent calls tools directly via the LLM's native tool-use protocol. The orchestrator mediates each call (validate, execute, return result), enforcing safety and logging every invocation. The key advantage: the agent can read realm state, react to what it sees, and make multi-step decisions within a single `run()` call — no need to wait for the next iteration.

### `FactoryAgent` Implementation

The first implementation wraps OpenRouter's chat completions API with native tool-use:

```typescript
class OpenRouterFactoryAgent implements FactoryAgent {
  constructor(private config: FactoryAgentConfig) {}

  async run(
    context: AgentContext,
    tools: FactoryTool[],
  ): Promise<AgentRunResult> {
    let messages = this.buildMessages(context);
    let toolDefs = this.buildToolDefinitions(tools);
    let toolCallLog: ToolCallEntry[] = [];

    // Multi-turn tool-calling loop
    while (true) {
      let response = await this.callOpenRouter(messages, toolDefs);

      if (response.stopReason === 'end_turn') {
        return this.parseRunResult(response, toolCallLog);
      }

      // Execute each tool call the LLM requested
      for (let toolCall of response.toolCalls) {
        let tool = tools.find((t) => t.name === toolCall.name);
        let start = Date.now();
        let result = await tool.execute(toolCall.args);
        toolCallLog.push({
          tool: toolCall.name,
          args: toolCall.args,
          result,
          durationMs: Date.now() - start,
        });
        // Append tool result to messages for next LLM turn
        messages.push({
          role: 'tool',
          toolCallId: toolCall.id,
          content: result,
        });
      }
    }
  }
}
```

### Prompt Architecture

The agent interface communicates with the LLM through a structured prompt assembled from templates and runtime context. This section specifies how prompts are built, what the LLM sees at each stage of the loop, and how the output format is enforced.

#### Prompt Templates

Prompts are assembled from Markdown template files stored in `packages/software-factory/prompts/`. Templates use simple `{{variable}}` interpolation — no template engine dependency. The orchestrator reads these files at startup and caches them.

```
packages/software-factory/prompts/
├── system.md              # role, rules, and realm context
├── ticket-implement.md    # instructions for implementing a ticket
├── ticket-test.md         # instructions for generating tests
├── ticket-iterate.md      # instructions for fixing after test failure
└── examples/
    ├── create-card.md     # example: creating a card definition + instance
    ├── create-test.md     # example: generating a test spec
    └── iterate-fix.md     # example: fixing code after test failure
```

Note: `action-schema.md` is no longer needed — tool definitions are provided natively via the LLM's tool-use API, not embedded in the prompt.

Keeping prompts as standalone Markdown files (not embedded in TypeScript) means they can be iterated on without code changes, reviewed in PRs as prose, and tested with different models by swapping only the template text.

#### Message Structure

Each `agent.run()` call starts with a system message and user message, then enters a multi-turn tool-calling loop. The orchestrator assembles the initial context, and the agent drives the session by calling tools and seeing results inline.

```typescript
// Initial messages sent to the LLM
[
  { role: 'system', content: systemPrompt },
  { role: 'user', content: ticketPrompt },
];
// + tool definitions provided via the API's tools parameter
// The LLM responds with tool_use blocks, orchestrator executes and returns
// tool_result blocks, and the loop continues until the agent stops.
```

The **system prompt** is the same for every call within a ticket: role definition, skills, and realm context.

The **user prompt** changes depending on where the orchestrator is in the execution loop:

- **First pass** — uses `ticket-implement.md`: project context, knowledge articles, ticket description, and instructions to implement + write tests.
- **Iteration pass** — uses `ticket-iterate.md`: everything from the first pass, plus a summary of previous tool calls and the test results from the last run.

Tool definitions are provided separately via the LLM API's native tool parameter — they are not embedded in the prompt text.

#### System Prompt

The system prompt is assembled once per ticket and stays constant across iterations. It defines who the agent is, what it can do, and the realm context.

Template: `prompts/system.md`

```markdown
# Role

You are a software factory agent. You implement Boxel cards and tests in
target realms based on ticket descriptions and project context.

You have access to tools for reading and writing files to realms, searching
realm state, running tests, and signaling completion. Use these tools to
inspect existing state before making changes — do not guess.

# Rules

- Every ticket must include at least one test file (via write_file to Tests/).
- Use search_realm and read_file to inspect existing cards before creating files.
- If you cannot proceed, call request_clarification with a description of what
  is blocked.
- When all work for the ticket is complete, call signal_done.

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
```

Tools are NOT embedded in the system prompt — they are provided via the LLM API's native tool definitions parameter. This ensures structured input/output validation and avoids the need for a custom action schema.

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

1. Use search_realm and read_file to inspect existing realm state
2. Use write_file to create or update card definitions (.gts) and/or card instances (.json) in the target realm
3. Use write_file to create test specs (.spec.ts) that verify your implementation
4. Call signal_done when complete

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

Return only test file writes (via write_file).
```

#### Test Iteration Prompt

Sent as the user message after a test failure. This is a **self-contained prompt** — it includes everything the agent needs: the original ticket context, a summary of what tools were called and what happened, and the test results. The agent does not need to "remember" a prior conversation because all relevant history is in this single message.

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

In the previous iteration, you made the following tool calls:

{{#each previousToolCalls}}

## {{tool}}({{argsJson}})

Result: {{resultSummary}}
{{/each}}

# Test Results

The orchestrator ran tests after your previous attempt. They failed.

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

```
{{/if}}
{{/each}}

# Instructions

Fix the failing tests. You have the same tools available. You can:

- Use read_file to inspect the current state of your implementation
- Use write_file to update implementation or test files
- Use search_realm to check what cards exist
- If the test expectation is wrong, fix the test
- If the implementation is wrong, fix the implementation

When done, call signal_done.

```

#### Iteration Flow

A single ticket may require multiple iterations. Each iteration is an independent `agent.run()` call — the orchestrator provides updated context:

```
Pass 1 (initial implementation):
  system: [system prompt with skills]
  user: [ticket-implement — project context, ticket description]
  tools: [write_file, read_file, search_realm, signal_done, ...]
  → Agent calls tools: search_realm → write_file × N → signal_done
  → Orchestrator runs tests → tests fail

Pass 2 (first fix):
  system: [same system prompt]
  user: [ticket-iterate — ticket context + pass 1 tool call summary + test failures]
  tools: [same tools]
  → Agent calls tools: read_file (inspect current state) → write_file (fixes) → signal_done
  → Orchestrator runs tests → tests fail again

Pass 3 (second fix):
  system: [same system prompt]
  user: [ticket-iterate — ticket context + pass 2 tool call summary + new test failures]
  tools: [same tools]
  → Agent calls tools: read_file → write_file (further fixes) → signal_done
  → Orchestrator runs tests → tests pass → ticket done
```

Each call is self-contained. The agent sees a summary of what it did on the **previous** iteration (the tool calls and test results are in the user message), but it does not see the full history of all iterations. This keeps the prompt size bounded and each call independent.

Within each iteration, the agent can make multiple tool calls in sequence — reading realm state, reacting to what it finds, and writing fixes — all within a single `run()` call. This is the key advantage over the declarative model: the agent can self-correct within an iteration rather than waiting for the next round-trip.

#### Iteration Limits

- `maxIterations` (default: 5) — maximum fix attempts before the orchestrator marks the ticket as blocked
- since each call is one-shot, there is no growing conversation to truncate — the prompt size is naturally bounded by the ticket context + one iteration's worth of actions and test results

#### Tool Call Validation

Since the agent uses native tool-use protocol, input/output validation is handled by the LLM API framework:

1. Tool calls have structured inputs validated against JSON Schema
2. Invalid tool names are rejected by the framework before reaching the executor
3. Each tool implementation validates its own arguments and returns structured results
4. Safety constraints (realm targeting, auth) are enforced inside each tool's `execute` function

If the LLM produces malformed tool calls repeatedly (e.g., a model that doesn't support tool-use well), the orchestrator marks the ticket as blocked after `maxIterations` failures.

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

Each `AgentExecutionLog` card captures every `agent.run()` call made for a ticket's implementation attempt. The `iterations` field is a structured Markdown document:

```markdown
## Iteration 1

### Prompt

<the assembled user prompt sent to the LLM — ticket-implement>

### Tool Calls

1. search_realm({ realm: "...", type_name: "StickyNote" }) → { data: [] } (12ms)
2. write_file({ path: "sticky-note.gts", content: "...", realm: "target" }) → { ok: true } (45ms)
3. write_file({ path: "Tests/sticky-note.spec.ts", content: "...", realm: "target" }) → { ok: true } (38ms)
4. signal_done() → { ok: true }

### Test Results

Status: failed
Passed: 0, Failed: 1
Error: "Cannot find module './sticky-note'"

---

## Iteration 2

### Prompt

<the assembled user prompt — ticket-iterate with previous tool calls + test failure>

### Tool Calls

1. read_file({ path: "sticky-note.gts", realm: "target" }) → { ok: true, content: "..." } (15ms)
2. write_file({ path: "sticky-note.gts", content: "...", realm: "target" }) → { ok: true } (42ms)
3. signal_done() → { ok: true }

### Test Results

Status: passed
Passed: 1, Failed: 0
```

Each iteration records: what prompt was sent, what tool calls the agent made (with arguments and results), and what test results came back. This is a complete, self-contained log — since each `run()` call is independent, no conversation context is needed to make sense of individual entries.

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
- the system prompt and tool definitions stay the same
- the orchestrator behavior is identical regardless of model
- model-specific quirks (tool-use format, token limits) are handled inside `OpenRouterFactoryAgent`, not in the orchestration loop
- the LLM must support native tool-use/function-calling — models that only support text completion would need a compatibility adapter that parses tool calls from text output

### Future: Multiple Agent Backends

The `FactoryAgent` interface also supports non-OpenRouter backends:

- a `ClaudeCodeFactoryAgent` that delegates to Claude Code's tool-use loop
- a `LocalModelFactoryAgent` for self-hosted models via Ollama or vLLM (requires tool-use support)
- a `MockFactoryAgent` for deterministic testing — accepts a pre-scripted sequence of tool calls to make

The orchestrator does not care which backend is used. It only depends on the `FactoryAgent` interface. Each backend is responsible for managing the tool-calling loop internally and returning an `AgentRunResult` with the tool call log.

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
1. Role definition and rules
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

Skills give the agent knowledge. Tools give the agent capabilities. The agent is given executable tool functions that it calls directly via the LLM's native tool-use protocol. Each tool wraps an underlying implementation (realm HTTP API, CLI script, or control signal) with safety middleware.

Tool categories:

- **Factory tools** — high-level operations like `write_file`, `read_file`, `search_realm`, `update_ticket`, `create_knowledge`, `run_tests`, `signal_done`, `request_clarification`
- **Script tools** — standalone CLI tools in `packages/software-factory/scripts/` (e.g., `search-realm`, `pick-ticket`)
- **Realm API tools** — direct realm server HTTP operations (e.g., `realm-read`, `realm-write`, `realm-delete`)
- **Boxel CLI tools** — `boxel` CLI commands (excluded until CS-10520 lands)

The agent calls these tools during its turn and sees results inline. Each tool implementation validates inputs, enforces safety (realm protection, auth), executes the operation, and returns the result.

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

The realm server exposes HTTP endpoints that are wrapped as `FactoryTool` functions the agent can call directly. Rather than hardcoding specific API calls in the orchestrator, the full range of realm server capabilities are exposed as tools. This means operations like realm creation, card CRUD, search, and batch mutations are all available to the agent — each tool's `execute` function enforces safety constraints, but the agent decides when and how to use them.

This is an important design principle: **any Boxel API call that the orchestrator might make should also be available as a tool the agent can call directly**. Safety constraints are enforced inside each tool's `execute` function, not at a central validation gate.

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

#### How the Orchestrator Builds Tool Functions

The orchestrator builds `FactoryTool[]` at startup. Each tool has a JSON Schema definition (for the LLM) and an `execute` function (for the orchestrator to run). The tools are passed to `agent.run(context, tools)`.

```typescript
// Example: building the write_file tool
let writeFileTool: FactoryTool = {
  name: 'write_file',
  description:
    'Write a file to a realm. The path must include the file extension.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Realm-relative file path with extension',
      },
      content: { type: 'string', description: 'File content' },
      realm: {
        type: 'string',
        enum: ['target', 'test'],
        description: 'Which realm to write to (default: target)',
      },
    },
    required: ['path', 'content'],
  },
  execute: async (args) => {
    let realmUrl = args.realm === 'test' ? testRealmUrl : targetRealmUrl;
    let auth = realmTokens[realmUrl];
    // All files written via writeModuleSource with card+source MIME type.
    // The realm server accepts raw content as-is regardless of extension.
    return writeModuleSource(realmUrl, args.path, args.content, {
      authorization: auth,
    });
  },
};
```

The tool definitions are sent to the LLM via the API's native tool parameter (not embedded in the prompt). The LLM calls tools using its native tool-use protocol, and the orchestrator executes each call through the tool's `execute` function.

```
System prompt structure:
1. Role definition and rules
2. Active skills (domain knowledge)
3. Realm URLs
(tools provided separately via API parameter)
```

#### How Tool Calls Are Executed

When the LLM makes a tool call during `agent.run()`:

1. the agent implementation looks up the `FactoryTool` by name
2. validates the arguments against the tool's JSON Schema
3. calls the tool's `execute` function (which enforces safety constraints internally)
4. returns the result to the LLM as a `tool_result` message
5. the LLM sees the result and can make more tool calls or finish

For script and boxel-cli tools, the `execute` function spawns a subprocess. For realm API tools, it makes an authenticated HTTP request. For factory-level tools (write_file, read_file, etc.), it calls the appropriate realm operation function directly.

```typescript
// The ToolExecutor class is still used internally for script/CLI/realm-api
// tool execution, but is now wrapped inside FactoryTool.execute functions
// rather than being called directly by a dispatcher.

class ToolExecutor {
  // Executes script, boxel-cli, or realm-api tools
  // Safety enforcement (realm protection, allowed targets) happens here
  async execute(
    toolName: string,
    toolArgs: Record<string, unknown>,
    options?: { authorization?: string },
  ): Promise<ToolResult>;
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

## Runtime JSON Schema for Card Type Tools

The `update_project`, `update_ticket`, and `create_knowledge` tools accept structured `attributes` and `relationships` parameters instead of a bare `content: string`. The JSON schemas for these parameters are derived from the actual card definitions at runtime, ensuring they never drift from the source of truth.

### How It Works

1. **Host command**: `GetCardTypeSchemaCommand` (`packages/host/app/commands/get-card-type-schema.ts`) takes a `ResolvedCodeRef` (`{ module, name }`) and calls `generateJsonSchemaForCardType()` in the prerenderer's browser context where the Loader, CardAPI, and field mappings are available.

2. **Transport**: `runRealmCommand()` in `realm-operations.ts` calls the realm server's `/run-command` endpoint, which proxies to the prerenderer. This is a general-purpose function — any host command can be invoked through it.

3. **Schema fetch**: `fetchCardTypeSchema()` in `darkfactory-schemas.ts` wraps `runRealmCommand` with the `GetCardTypeSchemaCommand` specifier and parses the `JsonCard` result.

4. **Caching**: Before the execution loop starts, the factory fetches schemas for `Project`, `Ticket`, and `KnowledgeArticle` once per session. The results are cached in a `Map<string, CardSchema>` and passed to the tool builder via `ToolBuilderConfig.cardTypeSchemas`.

5. **Fallback**: If the realm server is unavailable or the command fails, static hand-crafted schemas in `darkfactory-schemas.ts` are used as fallbacks.

### LLM-Facing Tool Interface

The card tools accept structured parameters with field-level type/enum/description info:

```
update_ticket({
  path: "Ticket/1.json",
  attributes: {
    status: "in_progress",     // enum: backlog, in_progress, blocked, review, done
    summary: "Build sticky note",
    agentNotes: "Started implementation..."
  },
  relationships: {
    project: { links: { self: "https://realm/Project/mvp" } }
  }
})
```

The tool's `execute` function auto-constructs the JSON:API document with the correct `adoptsFrom` module URL — the LLM never needs to know about JSON:API format.

### `run_command` Tool

A general-purpose `run_command` tool is also available to the LLM, allowing it to invoke any host command via the prerenderer. This is documented in the `software-factory-operations` skill and is useful for dynamically inspecting card type schemas, serializing cards, or running other host operations.

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
- `packages/software-factory/scripts/lib/factory-tool-builder.ts` (builds FactoryTool[] from config)
- `packages/software-factory/scripts/lib/factory-prompt-loader.ts`
- `packages/software-factory/prompts/system.md`
- `packages/software-factory/prompts/ticket-implement.md`
- `packages/software-factory/prompts/ticket-test.md`
- `packages/software-factory/prompts/ticket-iterate.md`
- `packages/software-factory/prompts/examples/create-card.md`
- `packages/software-factory/prompts/examples/create-test.md`
- `packages/software-factory/prompts/examples/iterate-fix.md`

Note: `action-schema.md` is no longer needed — tool definitions are provided natively via the LLM's tool-use API. The `factory-action-dispatcher.ts` is replaced by `factory-tool-builder.ts` which constructs `FactoryTool[]` with embedded safety middleware.

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

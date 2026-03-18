# One-Shot Software Factory Plan

## Goal

Turn the current `experiment_1` workflow from an agent-assisted toolbox into a single-entrypoint flow that can:

1. accept a brief URL like `http://localhost:4201/software-factory/Wiki/sticky-note`
2. target a local Boxel realm such as `packages/realm-server/realms/localhost_4201/hassan1/personal`
3. bootstrap project artifacts in that target realm
4. immediately enter implementation and verification iterations
5. stop only when a clear completion or blocker condition is reached

This document covers:

- the desired one-shot flow
- what is currently missing
- the minimum implementation needed in `experiment_1`

## Realm Roles

The software factory uses three different realm roles that should stay distinct:

- source realm
  - `packages/software-factory/realm`
  - publishes shared modules, source cards, briefs, templates, and other driver content
- target realm
  - the user-specified realm passed to `factory:go`
  - receives the generated `Project`, `Ticket`, `KnowledgeArticle`, tests, and implementation artifacts
- fixture realm
  - disposable test input used only for verification
  - may adopt from the public source realm but should not be treated as user output

Normal factory output should land in the target realm, not in `packages/software-factory/realm`.

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
  --target-realm-path /home/hassan/codez/boxel/packages/realm-server/realms/localhost_4201/hassan1/personal \
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
- `target-realm-path`
- optional `target-realm-url`
- optional mode:
  - `bootstrap`
  - `implement`
  - `resume`

Required behavior:

- fetch the brief card JSON
- normalize the brief into a concise internal representation
- detect whether the brief is vague
- if vague, automatically bias toward a thin MVP

### Phase 2: Target Realm Preparation

Required behavior:

- resolve the target realm URL from `.boxel-sync.json` or CLI arguments
- ensure the target realm can resolve the tracker module from the shared source realm, or explicitly install a local copy if that is the chosen bootstrap strategy
- ensure the target realm has a visible entry surface such as `cards-grid.json`

Minimum requirement:

- the target realm must be self-contained enough that `Project`, `Ticket`, and `KnowledgeArticle` cards resolve locally

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

### Phase 4: Execution Loop

Required behavior:

1. pick the active or next available ticket
2. inspect related project and knowledge cards
3. implement the ticket in the target realm
4. verify the result
5. update `agentNotes`, `updatedAt`, and `status`
6. create or update knowledge cards when meaningful decisions occur
7. continue until:
   - the MVP is done
   - a blocker requires user input
   - verification cannot proceed

### Phase 5: Verification

Default verification policy:

- if project tests already exist, use `test:realm`
- if no tests exist yet, create the smallest meaningful verification surface
- for early Boxel card work, successful rendering of a concrete instance in the host app is a valid first verification step

Implementation note:

- the Playwright harness in `packages/software-factory` can also be reused to generate and run automated card-rendering tests for artifacts created by the factory
- this is useful when the factory needs a real browser-level verification path for generated cards
- it is not necessarily the most efficient default for every ticket, so the first verification move should still prefer the smallest verification surface that proves the change

The flow must not stall just because full test infrastructure does not yet exist.

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

The target realm currently needs tracker support added manually or implicitly. That should be an explicit, reusable setup step.

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

## Minimal Implementation Plan For `experiment_1`

This plan aims for the smallest change set that produces a believable `factory:go` flow.

## Scope

Add a new script and a small shared library layer. Do not attempt a fully autonomous general planner on the first pass.

The first version should support:

- one brief URL
- one target realm path
- local Boxel realms
- Boxel-card implementation workflows
- simple bootstrap and first-ticket execution

## Proposed New Entry Point

Add a script:

```json
"factory:go": "ts-node --esm --transpileOnly scripts/factory-go.ts"
```

Expected usage:

```bash
npm run factory:go -- \
  --brief-url http://localhost:4201/software-factory/Wiki/sticky-note \
  --target-realm-path /home/hassan/codez/boxel/packages/realm-server/realms/localhost_4201/hassan1/personal \
  --mode implement
```

CLI parameters for the first version:

- `--brief-url`
  - Required. Absolute URL for the brief card that drives the one-shot flow.
- `--target-realm-path`
  - Required. Local filesystem path to the realm where generated artifacts should land.
- `--target-realm-url`
  - Optional. Explicit realm URL when path-based inference is not enough.
- `--mode`
  - Optional. `bootstrap`, `implement`, or `resume`. Default should be `implement`.
- `--help`
  - Optional. Prints command usage and exits without running the flow.

## Proposed Implementation Pieces

### A. `scripts/factory-go.ts`

This should be the top-level orchestrator.

Responsibilities:

- parse args
- fetch the brief
- resolve target realm path and URL
- ensure the target realm can consume the shared tracker module without confusing source content with generated output
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
- `cards-grid.json`

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

- resolve target realm URL from `.boxel-sync.json` when available
- infer local workspace URL from path when possible
- ensure the `darkfactory` module files exist in the target realm
- ensure `cards-grid.json` exists

This isolates the realm bootstrapping concern from the orchestration logic.

### D. `scripts/lib/factory-brief.ts`

New helper module for brief intake.

Responsibilities:

- fetch a brief card by URL
- extract useful fields from card JSON
- normalize vague briefs into a simple planning shape
- emit metadata like:
  - title
  - summary
  - content
  - source URL
  - ambiguity score or `isVague` flag

For version one, the `isVague` check can be heuristic and simple.

### E. `scripts/lib/factory-loop.ts`

New helper module for the first execution loop.

Responsibilities:

- find the active ticket
- if no active ticket, use the first eligible backlog ticket
- gather related knowledge and project context
- call the implementation backend
- update ticket state and notes after verification

For the first version, this does not need to be a general autonomous system. It only needs to perform one ticket deeply and leave the realm in a coherent state.

## Implementation Backend Choice

This is the main architectural decision.

There are two options:

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

## First-Version Execution Contract

The first version of `factory:go` should do exactly this:

1. fetch the brief
2. ensure the target realm contains the tracker module and visible entry surface
3. create or reconcile starter project artifacts
4. select the first actionable ticket
5. print a structured execution bundle for the agent or next stage

If run in `--mode implement`, it should then:

6. open the active ticket context
7. perform one implementation cycle
8. run verification
9. update ticket state

It does not need to complete an entire multi-ticket product in version one.

## File Changes For Minimal Version

Files to add:

- `packages/software-factory/scripts/factory-go.ts`
- `packages/software-factory/scripts/lib/factory-bootstrap.ts`
- `packages/software-factory/scripts/lib/factory-target-realm.ts`
- `packages/software-factory/scripts/lib/factory-brief.ts`
- `packages/software-factory/scripts/lib/factory-loop.ts`

Files to update:

- `packages/software-factory/package.json`
  - add `factory:go`
- `packages/software-factory/AGENTS.md`
  - document the new one-shot flow

Optional later additions:

- `packages/software-factory/tests/factory-go.spec.ts`
  - verifies bootstrap behavior
- generated card-test creation that reuses the existing `packages/software-factory` Playwright machinery when browser-level verification is warranted

## Suggested Output Contract

`factory:go` should emit machine-readable JSON at the end. Example shape:

```json
{
  "brief": {
    "url": "http://localhost:4201/software-factory/Wiki/sticky-note",
    "title": "Sticky Note",
    "isVague": true
  },
  "targetRealm": {
    "path": "/.../personal",
    "url": "http://localhost:4201/hassan1/personal/"
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
    "strategy": "render-first"
  }
}
```

This keeps the process inspectable and resumable.

## Acceptance Criteria For The First `factory:go`

- a user can point to a brief URL and a target realm path
- the target realm ends up with a coherent project bootstrap
- exactly one ticket becomes active
- rerunning does not create duplicate starter artifacts
- the flow can proceed directly into implementation work
- the system prefers a thin MVP when the brief is vague

## Recommended Delivery Order

1. add target realm bootstrap helpers
2. add brief fetch and normalization
3. add idempotent project artifact bootstrap
4. expose `factory:go`
5. add one-ticket implementation mode
6. add tests and stronger resume behavior

## Practical Conclusion

The missing piece is orchestration, not capability. The current project already has enough primitives to support a one-shot flow, but only after adding:

- a formal entrypoint
- deterministic bootstrap rules
- target realm preparation
- a minimal implementation loop

That is the smallest path to turning the current software-factory idea into something that feels like:

“Point at a brief, say go, and watch it enter the delivery loop.”

# Phase 2: Issue-Driven Agentic Loop

## Context

Phase 1 (`one-shot-factory-go-plan.md`) implements a fixed pipeline: intake → bootstrap → implement → test → iterate. This works for the first pass but hard-codes the loop structure and the relationship between implementation and testing.

Phase 2 moves to an **issue-driven loop** aligned with the target architecture in `architecture.md`. The orchestrator becomes a thin scheduler that picks the next issue and delegates implementation work to the agent. The orchestrator owns validation (parse, lint, evaluate, instantiate, run tests) after every agent turn, feeding failures back so the agent can self-correct.

## Core Idea

The factory loop iterates over **issues in the project**, one at a time. Each issue describes a unit of work the agent should complete. The orchestrator's only job is:

1. Select the next unblocked issue (based on ordering / dependency rules)
2. Hand it to the agent
3. Wait for the agent to exit
4. Run validation (parse, lint, evaluate, instantiate, run tests) — feed failures back as context
5. Read updated issue state and repeat (inner loop) or advance to next issue (outer loop)

The agent always exits the same way — the orchestrator reads the issue's updated status/tags to decide what happened. If the agent tagged the issue as blocked (e.g., needs human clarification), the orchestrator skips it and moves on. If the issue is marked done, the orchestrator advances. This keeps the agent's exit path uniform — it doesn't need a separate "blocked" signal in its return type, it just updates the issue and exits.

This makes the loop generic. It doesn't need to know whether an issue is "implement a card", "write tests", "create the project spec", or "break down the brief into tickets". The agent reads the issue, does the work, updates the issue status, and exits.

## Issue Ordering and Dependencies

Issues need properties that let the orchestrator determine execution order. Possible fields (may use a combination):

- **priority** — enum (`critical`, `high`, `medium`, `low`), critical = execute first
- **predecessors / blockedBy** — explicit dependency edges; an issue cannot start until its blockers are done
- **order** — explicit sequence number for tie-breaking

The selection algorithm (implemented in `IssueScheduler.pickNextIssue()`):

1. Filter to issues with status `backlog` or `in_progress`
2. Exclude issues whose `blockedBy` list contains any non-completed issue
3. Exclude exhausted issues (hit `maxIterationsPerIssue` in the current run)
4. Sort: `in_progress` first, then by priority (`critical` > `high` > `medium` > `low`), then by order (ascending)
5. Pick the first one

Resume semantics: if an issue is already `in_progress`, it takes priority over `backlog` issues (the factory was interrupted and should continue where it left off).

## Validation Phase After Every Iteration

The loop has two levels:

- **Outer loop** — iterates over all unblocked, unfinished issues (picks the next one when the current one is done or blocked)
- **Inner loop** — iterates on a single issue until the agent marks it done, blocked, or max iterations are reached

Every **inner-loop iteration** (agent turn) is followed by a **validation phase** owned by the orchestrator. An issue may require multiple iterations before it's done — validation runs after each one. This is similar to how Phase 1 runs tests after the agent signals done, but expanded to a full automated evaluation pipeline. The agent does not need to create separate "run tests" issues — validation is baked into the inner loop.

### Validation Steps

After each agent turn in the inner loop, the orchestrator runs these checks deterministically (as described in `architecture.md`):

1. **Parse** — Verify that all modified `.gts` and `.json` files are syntactically valid
2. **Lint** — Run lint checks on modified files
3. **Module evaluation** — Ensure card modules load and evaluate without errors (import resolution, no runtime crashes)
4. **Card instantiation** — Verify that sample card instances can be instantiated from their definitions
5. **Run existing tests** — Execute all QUnit `.test.gts` files in the target realm via the QUnit test page

### Validation Architecture (CS-10675)

The validation pipeline is implemented as a modular system in `src/validators/`:

**`ValidationStepRunner` interface** — the contract every step must implement:

```typescript
interface ValidationStepRunner {
  readonly step: ValidationStep;
  run(targetRealmUrl: string): Promise<ValidationStepResult>;
  formatForContext(result: ValidationStepResult): string;
}
```

**`ValidationPipeline` class** — implements the `Validator` interface and composes step runners:

- Steps run **concurrently** via `Promise.allSettled()` — a failure or exception in one step does not prevent others from running
- Exceptions thrown by a step are captured as failed `ValidationStepResult` entries with the error message
- `formatForContext()` delegates to each step runner to produce LLM-friendly markdown
- `createDefaultPipeline(config)` factory function composes all 5 steps with config injection

**Step-specific failure shapes** — each validation type carries its own structured data in `ValidationStepResult.details` (flattened POJOs, not cards):

- **Test step**: `{ testRunId, passedCount, failedCount, failures: [{ testName, module, message, stackTrace }] }` — reads back the completed TestRun card from the realm for detailed failure data (will become cheap local filesystem reads after boxel-cli integration)
- **Future parse/lint/evaluate/instantiate steps**: each defines its own `details` shape

**Adding a new validation step** = creating a new module file in `src/validators/` + replacing the `NoOpStepRunner` in `createDefaultPipeline()`.

### Handling Failures

Validation failures are fed back to the agent as context in the **next inner-loop iteration**. The orchestrator does not create fix issues for validation failures — it iterates with the failure details so the agent can self-correct. This mirrors Phase 1's approach (feed test results back, iterate) but with a broader validation pipeline.

The inner loop continues until:

- The agent marks the issue as done (all validation passes)
- The agent marks the issue as blocked (needs human input)
- Max iterations are reached with **failing validation** — the orchestrator blocks the issue with the reason ("max iteration limit reached") and the formatted validation failure context in the issue description, then moves to the next issue
- Max iterations are reached with **passing validation** — the issue is exhausted but not blocked (agent did not mark done despite passing validation)

The agent always has the option to create new issues via tool calls if it determines that a failure requires separate work (e.g., "this card definition depends on another card that doesn't exist yet — creating a new issue for it"). But the orchestrator does not force this — the agent decides.

### What This Means for Task Breakdown

During task breakdown, the agent organizes implementation issues around **entry-point cards** — the top-level cards users interact with directly and that should be discoverable in the Boxel catalog. The agent creates **one issue per entry-point card**, where each issue covers:

- The card definition (`.gts`) and any interior/support cards it depends on
- QUnit tests (`.test.gts`) for the entry-point card and all its support cards
- A Catalog Spec (`Spec/<card-name>.json`) with realistic example instances linked via `linkedExamples`

Interior cards (field cards, helper cards, linked supporting types) are implemented as part of their entry-point card's issue. They need tests but do not need their own catalog specs or separate issues.

If the brief describes only one entry-point card, there will be one implementation issue. If it describes multiple, there will be one per entry-point card. Issues are ordered so that **dependency cards are implemented before cards that consume them** — if card B uses card A as a field type or linked card, card A's issue gets a lower `order` and card B's issue has `blockedBy` pointing to card A's issue. This ensures the agent builds foundational cards first.

Each implementation issue must carry `project` and `relatedKnowledge` relationships pointing to the Project and KnowledgeArticle cards created during bootstrap. This is how `ContextBuilder.buildForIssue()` loads project scope and brief context for the agent when working on these issues.

The agent does **not** need to create "run tests" issues. Test execution happens automatically as part of the validation phase after every inner-loop iteration.

### Validation Behavior for Bootstrap Issues

Bootstrap issues (the seed issue that creates Project, KnowledgeArticles, and implementation issues) produce no testable code artifacts — only JSON card instances. Validation still runs after every inner-loop iteration, but each step gracefully handles "nothing to validate":

| Step                   | Bootstrap behavior                                                   |
| ---------------------- | -------------------------------------------------------------------- |
| **Parse**              | Checks created `.json` files are valid — useful                      |
| **Lint**               | No-op for JSON card instances — pass                                 |
| **Module evaluation**  | No `.gts` modules created — no-op, pass                              |
| **Card instantiation** | Verifies Project/KnowledgeArticle/Issue instances are valid — useful |
| **Run tests**          | No test files exist yet — vacuous pass                               |

**Design principle**: No special-casing per issue type. Each validation step returns `passed: true` with an empty errors array when there is nothing to validate. "Nothing to validate" is a pass, not an error.

The inner loop exit for bootstrap follows the same mechanism as any other issue: the agent marks the seed issue as `done` via tool calls, `refreshIssueState()` reads the updated status, and the inner loop condition (`issue.status !== 'done'`) exits. The outer loop then calls `pickNextIssue()` and finds the newly created implementation issues.

### Relationship to Phase 1

Phase 1 calls this "testing" — the orchestrator runs tests after the agent signals done, feeds failures back, and iterates. Phase 2 generalizes this to a full validation pipeline (parse + lint + evaluate + instantiate + test) and feeds all failures back in the same way. The key evolution is that validation is broader (not just tests) and runs after every agent turn (not just when the agent signals done). The validation is still orchestrator-owned and deterministic — the agent never decides whether to run validation.

## Bootstrap as Part of the Agentic Loop

In phase 1, bootstrap (creating the Project, KnowledgeArticles, and initial Tickets) is a separate orchestrator phase that runs before the loop. In phase 2, bootstrap is itself driven by issues.

The flow becomes:

1. Factory starts with a brief URL and a target realm
2. The orchestrator creates a single **seed issue** in the realm: `issueType: 'bootstrap'`, `status: 'backlog'`, `priority: 'critical'`, `order: 0` — this ensures `IssueScheduler.pickNextIssue()` picks it first
3. The agent picks up this seed issue, reads the brief, and creates:
   - The Project card
   - KnowledgeArticle cards (brief context + agent onboarding)
   - One implementation issue per entry-point card, with `project` and `relatedKnowledge` relationships wired
4. The agent calls `signal_done()` — the orchestrator marks the seed issue as done after validation passes
5. The orchestrator now has a populated issue backlog and continues the normal loop

Seed issue creation is **idempotent** — `createSeedIssue()` checks if `Issues/bootstrap-seed` already exists before writing. This supports crash recovery: if the factory restarts, the seed issue is already in the realm and the loop picks it up.

The `ContextBuilder.buildForIssue()` handles the bootstrap case where no Project exists yet by supplying a minimal stub (`{ id: 'bootstrap-pending' }`) when `loadProject()` returns `undefined` and the issue has `issueType === 'bootstrap'`. This keeps `AgentContext.project` required (no type ripple) while the bootstrap prompt template doesn't reference project fields.

The `IssueTypeField` enum in `darkfactory.gts` includes `bootstrap` as a valid value so seed issues render correctly in the Boxel UI.

This is the "quirk" where an issue's job is to create the project itself. But it's a natural fit — the LLM participates in brief processing and task breakdown as part of the loop, not as a separate hard-coded phase.

### Benefits

- The LLM can ask clarifying questions during bootstrap (by tagging the seed issue as blocked)
- Task breakdown quality improves because the LLM sees the full brief context and can make judgment calls
- The bootstrap process is testable with the same MockFactoryAgent pattern used for implementation issues
- Resume works naturally — if the factory crashes during bootstrap, the seed issue is still `in_progress` and gets picked up on restart

## Orchestrator: Issue Loop + Validation

The phase 2 orchestrator is a thin scheduler with a built-in validation phase that runs after every agent turn:

```typescript
// As implemented in runIssueLoop() — src/issue-loop.ts
let exhaustedIssues = new Set<string>();

while (
  scheduler.hasUnblockedIssues(exhaustedIssues) &&
  outerCycles < maxOuterCycles
) {
  let issue = scheduler.pickNextIssue(exhaustedIssues);

  // Orchestrator sets in_progress on pickup
  await issueStore.updateIssue(issue.id, { status: 'in_progress' });

  // Inner loop: multiple iterations per issue
  let validationResults = undefined;
  let exitReason = 'max_iterations';
  for (let iteration = 1; iteration <= maxIterationsPerIssue; iteration++) {
    let context = await contextBuilder.buildForIssue({
      issue,
      targetRealmUrl,
      validationResults,
      briefUrl,
    });
    let result = await agent.run(context, tools);

    // Validation phase — runs after EVERY agent turn
    validationResults = await validator.validate(targetRealmUrl);

    // Orchestrator promotes to done: signal_done + validation passed
    let agentSignaledDone = result.toolCalls.some(
      (tc) => tc.tool === 'signal_done',
    );
    if (agentSignaledDone && validationResults?.passed) {
      await issueStore.updateIssue(issue.id, { status: 'done' });
    }

    issue = await scheduler.refreshIssueState(issue);

    if (issue.status === 'done' || issue.status === 'blocked') {
      exitReason = issue.status;
      break;
    }
    // If agent signaled done but validation failed, continue iterating
  }

  if (exitReason === 'max_iterations') {
    if (validationResults && !validationResults.passed) {
      exitReason = 'blocked';
      await issueStore.updateIssue(issue.id, {
        status: 'blocked',
        description: buildMaxIterationBlockedDescription(validationResults),
      });
    }
    exhaustedIssues.add(issue.id);
  }

  await scheduler.loadIssues();
}

// Mark project completed when all issues done
if (outcome === 'all_issues_done') {
  await issueStore.updateProjectStatus('completed');
}
```

The orchestrator owns all status transitions. The agent signals intent via `signal_done()` (for completion) or `update_issue({ status: 'blocked' })` (for blocking). The orchestrator decides whether to actually promote based on validation results. Validation failures are fed back as context in the next inner-loop iteration so the agent can self-correct.

All domain logic (what to implement, when to create sub-issues, when to tag as blocked) lives in the agent's prompt and skills. The orchestrator owns: issue selection, status transitions, agent invocation, validation, project completion, and max-iteration blocking.

### Issue Loading via searchRealm()

`RealmIssueStore` loads issues from the target realm using `searchRealm()` from `realm-operations.ts`. The search filter uses the absolute darkfactory module URL (from `inferDarkfactoryModuleUrl(targetRealmUrl)`), which varies by environment (production, staging, localhost). The store maps JSON:API card responses to `SchedulableIssue` objects.

Boxel encodes `linksToMany` relationships with dotted keys rather than JSON:API `data` arrays:

```json
{
  "relationships": {
    "blockedBy.0": { "links": { "self": "../Issues/issue-a" } },
    "blockedBy.1": { "links": { "self": "../Issues/issue-b" } }
  }
}
```

The `extractLinksToManyIds()` helper parses this format to extract blocker IDs for dependency resolution.

When `searchRealm()` fails (auth, network, query errors), the store logs at `warn` level and returns an empty list — preventing the loop from silently treating a failure as "no issues exist."

### Loop Outcome Determination

The loop distinguishes several terminal states:

| Condition                                     | Outcome               |
| --------------------------------------------- | --------------------- |
| No issues loaded                              | `all_issues_done`     |
| Issues exist but all blocked at startup       | `no_unblocked_issues` |
| All issues completed successfully             | `all_issues_done`     |
| Some issues done, others blocked or exhausted | `no_unblocked_issues` |
| Safety guard hit                              | `max_outer_cycles`    |

## Schema Refinement: darkfactory.gts

Phase 1 defined Project and Ticket card types in `darkfactory.gts` with aspirational fields that were never used. Phase 2 trims these to only the fields that are actually set or read in code, and renames Ticket → Issue to match the issue-driven loop language.

### Project Card — Trimmed

**Keep** (actively set or read in bootstrap, prompts, skill loader, or tool builder):

| Field                   | Type                          | Used By                                          |
| ----------------------- | ----------------------------- | ------------------------------------------------ |
| `projectCode`           | String                        | Bootstrap, tests, templates                      |
| `projectName`           | String                        | Bootstrap, prompts, templates                    |
| `projectStatus`         | ProjectStatusField enum       | Bootstrap (set to 'active'), templates           |
| `objective`             | TextAreaField                 | Bootstrap (from brief summary), prompts          |
| `scope`                 | MarkdownField                 | Bootstrap (from brief sections), tests           |
| `technicalContext`      | MarkdownField                 | Bootstrap, templates                             |
| `issues`                | linksToMany(Issue) with query | Auto-queried, templates (renamed from `tickets`) |
| `knowledgeBase`         | linksToMany(KnowledgeArticle) | Bootstrap, skill loader                          |
| `successCriteria`       | MarkdownField                 | Bootstrap, prompts                               |
| `testArtifactsRealmUrl` | StringField                   | Tool builder (test execution)                    |

**Drop** (defined but never set or read by factory code):

| Field        | Why Drop                                            |
| ------------ | --------------------------------------------------- |
| `deadline`   | Never set or read                                   |
| `teamAgents` | Only in demo fixtures — never read by factory logic |
| `risks`      | Never set or read                                   |
| `createdAt`  | Never set or read on Project (Tickets do use it)    |

### Ticket → Issue Card — Renamed and Trimmed

Rename `Ticket` to `Issue` throughout. Field renames: `ticketId` → `issueId`, `ticketType` → `issueType`.

**Keep** (actively set or read):

| Field                | Type                          | Used By                                                             |
| -------------------- | ----------------------------- | ------------------------------------------------------------------- |
| `issueId`            | String                        | Bootstrap, tests, templates (was `ticketId`)                        |
| `summary`            | String                        | Bootstrap, prompts, templates                                       |
| `description`        | MarkdownField                 | Bootstrap, templates                                                |
| `issueType`          | IssueTypeField enum           | Bootstrap (set to 'feature'), tests (was `ticketType`)              |
| `status`             | IssueStatusField enum         | Bootstrap, factory-implement.ts (updated post-completion), prompts  |
| `priority`           | IssuePriorityField enum       | Bootstrap, prompts, templates                                       |
| `project`            | linksTo(Project)              | Bootstrap, skill loader                                             |
| `assignedAgent`      | linksTo(AgentProfile)         | pick-ticket.ts (assignment workflow)                                |
| `relatedKnowledge`   | linksToMany(KnowledgeArticle) | Skill loader (filters skills by knowledge tags)                     |
| `acceptanceCriteria` | MarkdownField                 | Bootstrap, prompts                                                  |
| `createdAt`          | DateTimeField                 | Bootstrap (set to context.now)                                      |
| `updatedAt`          | DateTimeField                 | Bootstrap (set to context.now)                                      |
| `comments`           | containsMany(Comment)         | Agent tool (add_comment), human replies, validation failure logging |

**Drop** (defined but never set or read):

| Field            | Why Drop                                                                             |
| ---------------- | ------------------------------------------------------------------------------------ |
| `relatedTickets` | Never set or read (Phase 2 uses `blockedBy`/`predecessors` for dependencies instead) |
| `agentNotes`     | Never set or read                                                                    |
| `estimatedHours` | Never set or read                                                                    |
| `actualHours`    | Never set or read                                                                    |

### New Fields for Phase 2

The issue-driven loop needs dependency tracking fields not in Phase 1:

| Field       | Type                  | Purpose                                                               |
| ----------- | --------------------- | --------------------------------------------------------------------- |
| `blockedBy` | linksToMany(Issue)    | Explicit dependency edges — issue can't start until blockers are done |
| `order`     | NumberField           | Sequence number for tie-breaking when priorities are equal            |
| `comments`  | containsMany(Comment) | Append-only log of structured comments on an issue                    |

These were described in the "Issue Ordering and Dependencies" section above but need to be added to the Issue card definition.

### Comment FieldDef and `add_comment` Tool

`Comment` is a compound `FieldDef` (not a `CardDef`) with three fields:

- `body` (MarkdownField) — the comment text
- `author` (StringField) — who wrote the comment (e.g., "factory-agent", "human")
- `datetime` (DateTimeField) — when the comment was created

The `add_comment` factory tool appends comments to an existing issue. It reads the issue, appends a new comment to the `comments` array, and writes back the full document. This is an append-only log pattern: comments are never edited or deleted, only appended.

**Why structured comments instead of modifying the description?**

- The issue description captures the _original intent_ — what needs to be done. Comments capture _evolving context_ — what was tried, what feedback was given, what status updates occurred.
- Append-only means no data loss: each comment is preserved with its author and timestamp.
- The agent can add comments without risking accidental description corruption.
- Human replies (e.g., resolving a clarification) are also modeled as comments, creating a unified conversation thread on the issue.

### Future: Adopt from Catalog Task Tracker Cards

The darkfactory Project and Issue definitions are a stopgap — they duplicate fields that should come from the high-quality task tracker cards in the catalog. Longer term, both should `adoptsFrom` the catalog's task tracker card types rather than maintaining their own field definitions. This means:

- Project adopts from the catalog's Project/Board card (inherits status tracking, team management, etc.)
- Issue adopts from the catalog's Task/Issue card (inherits status workflows, priority, dependencies, etc.)
- darkfactory.gts only adds factory-specific fields (e.g., `testArtifactsRealmUrl`) on top of the inherited base

This aligns with the catalog-first philosophy: the factory uses the same card types that users create in Boxel, not a parallel schema. It also means improvements to the catalog task tracker (better status workflows, richer dependency modeling) automatically flow into the factory.

CS-10671 trims and renames the current schema as a first step. The adoption from catalog task tracker cards may happen as part of Phase 2 or as a follow-on — timing TBD.

## Issue Lifecycle

```
backlog → in_progress → done
                      → blocked (needs human input or max iterations with failing validation)
```

### Orchestrator Owns Status Transitions

**The orchestrator — not the agent — manages issue status transitions.** This is a key design decision validated through end-to-end testing. Allowing the agent to set status directly caused multiple problems:

- The agent would mark issues as `done` before validation passed, causing the loop to exit prematurely with failing tests
- The `update_issue` tool's full-document write would clobber existing attributes when the agent only intended to update status
- The agent's status updates conflicted with the orchestrator's view of issue state

The status transition rules are:

| Transition                | Owner                 | Trigger                                                                                    |
| ------------------------- | --------------------- | ------------------------------------------------------------------------------------------ |
| `backlog` → `in_progress` | Orchestrator          | Issue picked up by the loop                                                                |
| `in_progress` → `done`    | Orchestrator          | Agent calls `signal_done` AND validation passes                                            |
| `in_progress` → `blocked` | Agent or Orchestrator | Agent sets `blocked` via `update_issue`, or max iterations reached with failing validation |
| `blocked` → `backlog`     | Agent                 | Agent unblocks via `update_issue`                                                          |

The `update_issue` tool strips disallowed status values — only `blocked` and `backlog` pass through. It also strips `description` — issue descriptions are immutable after creation (see below). The agent signals completion via `signal_done()`, and the loop promotes to `done` only when validation also passes. If the agent signals done but validation fails, the loop continues iterating with the failure details.

### Issue Descriptions Are Immutable

**Issue descriptions must never be modified after creation.** The description captures the original intent of the issue. All post-creation context — blocked reasons, validation failures, progress notes, human replies — must be added as **comments** via the `add_comment` tool or `IssueStore.addComment()`.

This design principle is enforced at multiple levels:

- The `update_issue` agent tool strips `description` from attributes before writing
- The orchestrator's max-iteration blocking adds failure context as a comment (author: `orchestrator`), not by overwriting the description
- The `IssueStore.updateIssue()` interface accepts only `{ status?: string }` — no `description` field
- Skills and system prompts instruct the agent to use `add_comment` for all post-creation context

The `add_comment` tool and `addCommentToIssue()` realm operation implement the centralized read-patch-write logic for appending comments. Both the agent tool and the orchestrator's `IssueStore` delegate to this single function.

### Project Completion

When the loop outcome is `all_issues_done`, the orchestrator automatically sets the project's `projectStatus` to `completed` via `IssueStore.updateProjectStatus()`.

### Card Update Tools Use Read-Patch-Write

The `update_issue`, `update_project`, and `create_knowledge` tools perform a **read-patch-write** cycle: they read the existing card source, merge the agent-provided attributes on top, and write back the merged document. This preserves attributes the agent didn't include in its update call. Earlier versions used a full-document write via `buildCardDocument()` which would clobber existing attributes — this was identified as a critical bug during e2e testing (bootstrap-seed issue was reduced to just `status` and `updatedAt` after an update).

### run_tests Tool Removed from Agent

The `run_tests` tool is **not exposed** to the agent. The validation pipeline runs tests automatically after every agent turn (after `signal_done`). Giving the agent the tool caused it to waste iterations running tests manually, sometimes before writing test files, and creating duplicate TestRun instances. The system prompt and skills inform the agent that the orchestrator handles test execution.

The `run_command` tool description explicitly states it is for Boxel host commands only (format: `@cardstack/boxel-host/commands/<name>/default`), not shell commands or scripts.

### Playwright waitForFunction Timeout

The validation pipeline's test step uses Playwright's `page.waitForFunction()` to wait for QUnit completion. The timeout must be passed as the **third** argument (`page.waitForFunction(fn, null, { timeout })`) — passing it as the second argument treats it as `arg`, causing Playwright to use its 30s default. The timeout is set to 300s (5 minutes) to accommodate large test suites that can take 30-50s for 10-13 tests.

### darkfactory Module URL

The `buildCardDocument()` function takes the darkfactory module URL as a parameter — it must point to the `software-factory` realm (e.g., `http://localhost:4201/software-factory/darkfactory`), NOT the target realm. Earlier versions constructed the URL from the target realm URL, causing cards written via `update_issue` to have the wrong `adoptsFrom` module. This broke `refreshIssue()` searches which filter by type module URL.

The correct URL is computed once via `inferDarkfactoryModuleUrl(targetRealmUrl)` and threaded through `ToolBuilderConfig.darkfactoryModuleUrl`.

### File Path Extensions

All card tool paths (in `update_issue`, `update_project`, `create_knowledge`, `create_catalog_spec`) are normalized with `ensureJsonExtension()` before being passed to realm operations. The realm API uses `card+source` content negotiation which requires the full file path including `.json` extension. Card IDs (used inside JSON documents) do NOT include extensions — this is a different concept.

## Migration Path from Phase 1

Phase 1 and phase 2 coexist during the transition. The implementation lives in separate files to avoid touching Phase 1 code:

- `src/issue-scheduler.ts` — `IssueScheduler`, `IssueStore`, `RealmIssueStore`
- `src/issue-loop.ts` — `runIssueLoop()`, `Validator`, `NoOpValidator`, config/result types

The `LoopAgent` interface (`run(context, tools)`) is unchanged and reused by the issue loop. `LoopAgent`, `AgentRunResult`, and `AgentRunStatus` types are now in `factory-agent-types.ts` (relocated from `factory-loop.ts` to break the dependency). `LoopFactoryTool`/`LoopToolCallEntry` mirror interfaces in `factory-agent-types.ts` avoid circular imports with `factory-tool-builder.ts` — TypeScript's structural typing makes them assignment-compatible.

CS-10673 + CS-10708 wired the issue loop into `factory:go`: `src/factory-issue-loop-wiring.ts` constructs all Phase 2 infrastructure (RealmIssueStore, RealmIssueRelationshipLoader, ContextBuilder, tools, agent, ValidationPipeline) and calls `runIssueLoop()`. The `factory-entrypoint.ts` now creates a seed issue then delegates to this wiring. Phase 1's `factory-loop.ts` and `factory-implement.ts` remain for backward compatibility but are no longer called from the main entrypoint.

## Refactor: request_clarification → Blocking Issue

In phase 1, `request_clarification` is a pure control flow signal — the agent calls it, the loop returns `clarification_needed`, and the message appears in the JSON output. Nothing is persisted to the realm, so the clarification request is lost if the output isn't captured.

In phase 2, `request_clarification` should create a **blocking issue** in the realm that signals to the outside world that human input is needed. This makes clarification requests durable, visible in the Boxel UI, and resolvable by a human through the normal issue workflow.

### Proposed behavior

When the agent calls `request_clarification`:

1. Create a new issue in the target realm with:
   - **type**: `clarification`
   - **status**: `blocked`
   - **summary**: a short description of what's needed (from the agent's message)
   - **description**: full context — what the agent was working on, what it tried, and what specific input it needs from a human
   - **blockedBy**: (none — this issue IS the blocker)
   - **blocks**: the current issue the agent was working on (so the blocked issue can't resume until clarification is resolved)
2. Update the current issue's status to `blocked` with a reference to the clarification issue
3. The agent exits its turn

The orchestrator then sees the current issue is `blocked` and moves on (or stops if no other unblocked issues exist).

### Human resolution flow

A human resolves the clarification by:

1. Opening the clarification issue in Boxel
2. Adding a response (e.g., updating the issue description with the answer, or adding a comment)
3. Marking the clarification issue as `done`

This automatically unblocks the dependent issue. On the next orchestrator iteration, the previously-blocked issue becomes eligible for execution. The agent picks it up, sees the resolved clarification issue in context, and continues.

### Migration from phase 1

In phase 1, the tool stays as-is (signal-only). The phase 2 refactor replaces the tool's `execute` function to:

- Write the clarification issue to the realm via `writeCardSource`
- Update the current issue's `blockedBy` field
- Return the `CLARIFICATION_SIGNAL` (so the loop still exits correctly)

The `LoopAgent` and `runFactoryLoop` signatures don't change — the signal mechanism is preserved, but now it has a durable side effect.

## Boxel-CLI Integration

The boxel-cli integration work is tracked in a dedicated Linear project: **"Incorporate Boxel CLI to Monorepo"**. Key tickets include:

- **CS-10519** — Import boxel-cli into monorepo as `packages/boxel-cli`
- **CS-10520** — Factory as boxel-cli subcommands; migrate realm-operations; retire file I/O tools
- **CS-10642** — boxel-cli owns full auth lifecycle (realm server tokens, per-realm tokens, auto-acquisition)
- **CS-10613** — Skill alignment: deduplicate, establish consistent homes, create `boxel-api` skill
- **CS-10670** — boxel-cli publishes tool definitions for factory consumption (tool delegation)
- **CS-10666** — Create `boxel-api` skill (federated search, realm creation, auth model)
- **CS-10667** — Create `boxel-command` skill (host commands via prerenderer)
- **CS-10593** — Claude Code native LLM support (ClaudeCodeFactoryAgent)
- **CS-10594** — Codex CLI native support

### Architectural Principle: boxel-cli Owns the Entire Boxel API Surface

**Any code that makes an HTTP call to the realm server or Matrix API must live in boxel-cli.** The software factory never calls realm APIs directly — it imports from boxel-cli. This is not a convenience; it is a hard boundary.

This means:

- `realm-operations.ts` (20 functions wrapping realm HTTP endpoints) → migrates to boxel-cli
- Auth helpers (`realm-auth.ts`, `boxel.ts` Matrix/OpenID flows) → migrate to boxel-cli
- Skills that teach realm API concepts (search queries, federated endpoints, auth model) → live with boxel-cli
- The factory keeps only orchestration logic: the ralph loop, test execution orchestration, bootstrap flow, and issue scheduling

The factory becomes a pure consumer of boxel-cli's API layer. It calls `boxel sync`, `boxel pull`, `boxel create`, or imports boxel-cli's programmatic API — it never constructs HTTP requests to realm endpoints.

### What Migrates from `realm-operations.ts` to boxel-cli

The `realm-operations.ts` module was designed as a centralized, self-contained set of realm API wrappers with no factory-specific logic. It migrates wholesale:

| Function                        | Endpoint                     | boxel-cli Home                                                |
| ------------------------------- | ---------------------------- | ------------------------------------------------------------- |
| `searchRealm()`                 | `QUERY /_search`             | Evolves into federated search via `/_federated-search`        |
| `readFile()`                    | `GET /<path>`                | Absorbed by `boxel pull` / programmatic read API              |
| `writeFile()`                   | `POST /<path>`               | Absorbed by `boxel sync` / programmatic write API             |
| `deleteFile()`                  | `DELETE /<path>`             | Absorbed by `boxel sync --prefer-local` with deletions        |
| `atomicOperation()`             | `POST /_atomic`              | Already implemented in boxel-cli's batch upload               |
| `runRealmCommand()`             | `POST /_run-command`         | New `boxel command` subcommand (CS-10416)                     |
| `createRealm()`                 | `POST /_create-realm`        | New `boxel create-realm` subcommand                           |
| `getServerSession()`            | `POST /_server-session`      | Part of boxel-cli's auth layer                                |
| `getRealmScopedAuth()`          | `POST /_realm-auth`          | Part of boxel-cli's auth layer                                |
| `cancelAllIndexingJobs()`       | `POST /_cancel-indexing-job` | New boxel-cli API                                             |
| `waitForRealmReady()`           | `GET /_readiness-check`      | New boxel-cli API                                             |
| `waitForRealmFile()`            | `GET /<path>` (polling)      | New boxel-cli API                                             |
| `pullRealmFiles()`              | `GET /_mtimes` + files       | Already `boxel pull` (auth managed by boxel-cli per CS-10642) |
| `addRealmToMatrixAccountData()` | Matrix account data API      | Part of boxel-cli's auth/profile layer                        |

Auth helpers in `realm-auth.ts` and `boxel.ts` (Matrix login, OpenID token, realm server token, per-realm JWTs) also migrate to boxel-cli's auth layer.

After migration, `realm-operations.ts` is deleted. Direct `fetch()` calls to realm endpoints in `factory-bootstrap.ts` and `factory-target-realm.ts` are replaced with boxel-cli imports.

### Search Evolves to Federated

The current `searchRealm()` targets a single specified realm. In boxel-cli, this evolves into a federated search backed by the realm server's `/_federated-search` endpoint, which searches across **all realms the user has access to** using `multiRealmAuthorization`.

The initial implementation uses `/_federated-search` only. The realm server also exposes `/_federated-search-prerendered`, `/_federated-types`, and `/_federated-info`, but these are not in scope for the initial integration.

For the locally synced target realm, the LLM uses native grep/find — no API call needed. Federated search is for querying **remote** realms (catalog, base realm, other users' realms).

### Skill Placement Follows the API Boundary

Since boxel-cli owns the Boxel API surface, skills that teach realm API concepts live with boxel-cli:

- **`boxel-api`** (new skill) — search query syntax, federated endpoints, realm creation, auth model. Lives at `packages/boxel-cli/.agents/skills/`
- **CLI command skills** (`boxel-sync`, `boxel-track`, etc.) — already CLI-specific. Live at `packages/boxel-cli/.agents/skills/`
- **Card domain knowledge** (`boxel-development`, `boxel-file-structure`) — not API-specific, applies to anyone working with cards. Lives at root `.agents/skills/`
- **Factory orchestration** (`software-factory-operations`) — ralph loop, factory tools. Lives at `packages/software-factory/.agents/skills/`

### Background

Phase 1 uses HTTP API calls (`realm-operations.ts`) as the primary realm I/O path. Boxel-cli exists and has profile-based auth, but its auth model isn't flexible enough for the factory's needs — specifically, obtaining auth tokens for newly created realms on the fly. Boxel-cli also lives in a separate repository (`cardstack/boxel-cli`), making it difficult to evolve in lockstep with factory requirements.

Phase 2 solves both problems: integrate boxel-cli into the monorepo as a first-class package, extend its auth model to handle dynamically created realms, and use it as the primary realm I/O layer.

### Benefits of a Synced Local Workspace

With boxel-cli, the agent gets a local directory that mirrors a realm:

- **LLMs are already fluent with filesystem tools** — `cat`, `grep`, `ls`, `rm`, file writes. No custom `read_file` / `write_file` / `search_realm` wrappers needed for basic operations.
- **Batch writes are trivial** — write files locally, then `boxel sync . --prefer-local` to push them all at once.
- **CLI skills become usable** — the 6 CLI skills excluded in phase 1 become available to the factory agent.
- **Test files run directly** — the agent writes `.spec.ts` files to a local directory and Playwright runs them without pulling from a remote realm first.

### Monorepo Integration (CS-10520)

Boxel-cli currently lives in a separate repository (`cardstack/boxel-cli`). Phase 2 moves it into the Boxel monorepo as `packages/boxel-cli`:

1. **Import the package** into `packages/boxel-cli` with its existing source, tests, and build configuration
2. **Wire it into the monorepo** — add it to the pnpm workspace, ensure it builds alongside other packages, integrate with CI (linting, type-checking, test suite)
3. **Make it a dependency** of `packages/software-factory` so factory scripts can import CLI utilities directly (e.g., sync logic, auth helpers) rather than shelling out to `npx boxel`
4. **Preserve the standalone CLI** — `npx boxel` and `npm install -g boxel-cli` must continue to work for human users

Being in the monorepo means:

- Changes to boxel-cli and the factory can land in the same PR
- The factory's CI runs against the exact boxel-cli version it depends on — no version drift
- Boxel-cli gets the same CI rigor as other packages: linting, type-checking, thorough test coverage
- Shared types and utilities can be extracted to `runtime-common` instead of being duplicated

### boxel-cli Owns the Full Auth Lifecycle (CS-10642)

Boxel-cli already has profile-based auth — users log in via `boxel profile add`, and the CLI uses stored credentials to authenticate with realm servers. But the factory creates new realms on the fly and immediately needs to read/write to them. Profile-based auth only knows about realms the user has manually configured.

The principle that boxel-cli owns the entire Boxel API surface extends to auth. The factory should never touch a JWT directly — boxel-cli manages the full token lifecycle internally:

1. **Two-tier token model** — boxel-cli understands both realm server tokens (obtained via Matrix OpenID → `POST /_server-session`, grants server-level access) and per-realm tokens (obtained via `POST /_realm-auth`, grants access to specific realms). Both are cached and refreshed automatically.

2. **Automatic token acquisition on realm creation** — When `boxel create-realm` creates a new realm, boxel-cli automatically waits for readiness, obtains the per-realm JWT, and stores it in its auth state. Subsequent `boxel pull`/`boxel sync` on that realm Just Work — tokens are managed internally by boxel-cli.

3. **Programmatic auth API** — Export a `BoxelAuth` class (or similar) so the factory imports it and never constructs HTTP requests or manages tokens:

   ```typescript
   import { BoxelAuth } from '@cardstack/boxel-cli';
   const auth = new BoxelAuth(credentials);
   await auth.createRealm({ name, owner }); // token auto-acquired
   await auth.pull(realmUrl, workspaceDir); // uses stored token
   await auth.sync(workspaceDir, { preferLocal: true });
   ```

4. **Token refresh for long-running operations** — The factory loop runs for hours. boxel-cli's `RealmAuthClient` already has token refresh with 60s lead time — this extends to cover all realm operations so long-running sessions don't fail mid-stream.

After this, the factory deletes `realm-auth.ts`, auth portions of `boxel.ts`, and all `authorization`/`serverToken`/`realmTokens` fields threaded through its config types.

### Realm Creation via Boxel-CLI

Phase 1 creates realms by calling `POST /_create-realm` directly. Phase 2 moves this into boxel-cli as a first-class command. The exact CLI arguments are still being worked through, but the principle is:

- Boxel-cli already knows which realm server it's authenticated with (from the active profile). It should not require the realm server URL as a CLI argument.
- After creating a realm, boxel-cli incorporates the new realm's auth token into its auth state so subsequent commands (`boxel sync`, `boxel pull`, etc.) work immediately.
- The factory's `factory-target-realm.ts` becomes a thin wrapper that calls boxel-cli rather than making raw HTTP requests.

### Refactoring: Sync-First I/O Model

With boxel-cli integration, the factory's I/O model shifts from **per-file HTTP calls** to **sync-based batch operations**:

#### Phase 1 (HTTP-first)

```
Agent calls write_file({ path: "sticky-note.gts", content: "...", realm: "target" })
  → orchestrator POSTs to realm HTTP API with card+source MIME type
  → repeat for each file
```

#### Phase 2 (sync-first)

```
Agent writes files to local workspace directory using standard filesystem tools
  → boxel sync . --prefer-local (pushes all changes to realm in one batch)
  → or boxel track . --push (auto-pushes as files change)
```

This means:

- **`write_file` and `read_file` wrapper tools are replaced** by the LLM's native filesystem tools. The agent writes to `./sticky-note.gts` directly.
- **`search_realm` is replaced** by a combination of local `grep`/`find` for file-level searches and `boxel-search` (or the `search-realm` script tool) for structured card queries that require the realm index.
- **`realm-read`, `realm-write`, `realm-delete`** remain available for operations that must happen immediately on the live realm (e.g., updating a ticket status that another process is watching), but they are no longer the primary I/O path.
- **`realm-atomic`** remains for transactional multi-file operations where partial failure is unacceptable.

#### What Stays as Factory Tools (Backed by boxel-cli)

Some operations are inherently server-side and cannot be replaced by local file I/O. These remain as factory tools but are backed by boxel-cli imports — no direct HTTP calls from the factory:

- **`search_realms`** — federated search across all accessible realms via boxel-cli wrapping `/_federated-search`
- **`run_command`** — host commands via prerenderer, backed by boxel-cli wrapping `/_run-command`
- **`run_tests`** — Playwright orchestration (factory-specific, uses boxel-cli for file pulls)
- **`signal_done`** / **`request_clarification`** — control flow signals back to the ralph loop (factory-only, no API call)
- **`realm-create`** — backed by boxel-cli's `BoxelAuth.createRealm()` with auto token acquisition (CS-10642)

Auth tools (`realm-server-session`, `realm-auth`) are fully absorbed into boxel-cli's auth layer per CS-10642 — the factory never manages tokens.

#### Tool Registry Changes

The `ToolRegistry` in phase 2 includes all three categories:

```typescript
// Phase 1: only SCRIPT_TOOLS + REALM_API_TOOLS
// Phase 2: all tools available
let allManifests = [...SCRIPT_TOOLS, ...BOXEL_CLI_TOOLS, ...REALM_API_TOOLS];
```

`BOXEL_CLI_TOOLS` (`boxel-sync`, `boxel-push`, `boxel-pull`, `boxel-status`, `boxel-create`, `boxel-history`) become available to the agent. The factory-level wrapper tools (`write_file`, `read_file`, `search_realm`) can be retired or kept as convenience aliases that delegate to the filesystem + sync.

#### Skill Re-enablement and Alignment (CS-10613)

The 6 CLI skills excluded in phase 1 (`boxel-sync`, `boxel-track`, `boxel-watch`, `boxel-restore`, `boxel-repair`, `boxel-setup`) are re-enabled in the skill resolver. The `CLI_ONLY_SKILLS` exclusion list in `factory-skill-loader.ts` is removed.

Beyond re-enablement, CS-10613 performs a full skill alignment:

- **Deduplication** — 8 of 9 factory skills are identical copies in boxel-cli. Each skill gets a single source of truth.
- **Consistent homes** — Skills are placed based on what they teach:
  - CLI commands + realm API → `packages/boxel-cli/.agents/skills/` (boxel-sync, boxel-track, boxel-watch, boxel-repair, boxel-restore, boxel-setup, **boxel-api** NEW)
  - Card domain knowledge → root `.agents/skills/` (boxel-development, boxel-file-structure)
  - Factory orchestration → `packages/software-factory/.agents/skills/` (software-factory-operations)
- **New `boxel-api` skill** — Consolidates scattered realm API knowledge (search queries, federated endpoints, auth model, realm creation) into a canonical reference at boxel-cli. This fills the current gap where no skill covers federated endpoints, realm creation, or auth flows.
- **Skill content rewrite** — All skills updated to remove references to retired HTTP tools (`write_file`, `read_file`, `search_realm`). Skills teach Boxel-specific domain knowledge only — not how to read/write files (the LLM already knows).
- **Loader updates** — Factory's custom skill loader updated with fallback dirs: primary (software-factory) → fallback 1 (boxel-cli) → fallback 2 (root). Both Claude Code's native loader and the factory's programmatic loader read from the same skill files via symlinks.

### Migration Strategy

The refactor happens in stages to avoid a big-bang rewrite:

1. **Stage 1: Monorepo import** — Move boxel-cli into `packages/boxel-cli`. Set up CI (linting, type-checking, tests). All existing factory code continues to use HTTP-based realm operations unchanged.
2. **Stage 2: Auth extension (CS-10642)** — Extend boxel-cli auth to automatically acquire and store tokens for newly created realms. Add programmatic auth API. Factory tests verify that `boxel create` followed by `boxel sync` works seamlessly for factory-created realms.
3. **Stage 3: Sync-based workspace** — Factory entrypoint syncs the target realm to a local workspace before starting the agent loop. Agent writes files locally. A post-iteration sync pushes changes to the realm.
4. **Stage 4: Retire HTTP wrappers** — Remove `realm-operations.ts` stopgap functions (`writeModuleSource`, `readCardSource`, `writeCardSource`, `pullRealmFiles`). Replace with boxel-cli calls. Keep `searchRealm` for structured queries.
5. **Stage 5: Re-enable CLI skills** — Remove the `CLI_ONLY_SKILLS` filter from the skill resolver. Update CLI skill content for the factory agent context.

### Tool Delegation: boxel-cli Publishes Tool Definitions (CS-10670)

`factory-tool-builder.ts` currently hardcodes every tool's name, description, JSON schema parameters, and execute function (~14 tool definitions). When tools migrate to boxel-cli, the factory shouldn't have to maintain definitions for tools it doesn't own — that creates a coupling problem where parameter changes in boxel-cli require matching updates in the factory.

The fix: **boxel-cli publishes its own tool surface** and the factory consumes it via delegation.

boxel-cli exports a function that returns tool definitions:

```typescript
// In @cardstack/boxel-cli
export function getToolDefinitions(auth: BoxelAuth): BoxelToolDefinition[] {
  return [
    {
      name: 'search_realms',
      description: 'Federated search across all accessible realms',
      parameters: {
        /* JSON Schema */
      },
      execute: async (params) => auth.federatedSearch(params.query),
    },
    {
      name: 'run_command',
      description: 'Execute a host command via the prerenderer',
      parameters: {
        /* JSON Schema */
      },
      execute: async (params) => auth.runCommand(params.command, params.input),
    },
    // ... all boxel-cli tools, each with schema + implementation
  ];
}
```

The factory tool builder becomes a thin composition layer:

```typescript
// In software-factory
import { getToolDefinitions } from '@cardstack/boxel-cli';

function buildTools(auth: BoxelAuth): FactoryTool[] {
  const cliTools = getToolDefinitions(auth);   // delegated — boxel-cli owns these
  const factoryTools = [
    { name: 'signal_done', ... },              // factory-only
    { name: 'request_clarification', ... },    // factory-only
    { name: 'run_tests', ... },                // factory-specific Playwright orchestration
  ];
  return [...cliTools, ...factoryTools];
}
```

This means:

- **Single source of truth** — boxel-cli owns the name, description, schema, and implementation for its tools
- **Factory tool builder shrinks** — from ~14 manually defined tools to 3-4 factory-specific ones
- **No coupling** — adding or changing a boxel-cli tool automatically reflects in the factory with zero factory code changes
- **Skill alignment** — the `boxel-api` skill (CS-10666) and tool definitions are co-located in boxel-cli, so they stay in sync

#### Future: boxel-cli as MCP Server

A natural evolution is for boxel-cli to expose its tools as an **MCP (Model Context Protocol) server**. This would allow Claude Code, Codex CLI, or any MCP-compatible agent to discover and call boxel-cli tools directly — without the factory as intermediary.

In this model:

- boxel-cli runs `boxel mcp-server` (or is configured as an MCP server in `.claude/settings.json`)
- Claude Code connects and discovers all available tools: `search_realms`, `create_realm`, `run_command`, `sync`, `pull`, `push`, etc.
- The ralph loop can also connect as an MCP client when invoking the agent, so the agent gets boxel-cli tools alongside factory tools
- Tool definitions, schemas, and descriptions are served dynamically — always up to date

This ties into CS-10418 (realms exposing MCP servers) and creates a consistent tool discovery pattern across the Boxel ecosystem. The programmatic manifest (Option A above) is the right first step because it's simpler and works today. MCP is the path once the protocol stabilizes and tool discovery becomes the standard for agent runtimes.

### Impact on `factory-tool-builder.ts`

With tool delegation, the factory only manually defines tools it uniquely owns:

| Tool                    | Owner            | How it's defined                                   |
| ----------------------- | ---------------- | -------------------------------------------------- |
| `search_realms`         | boxel-cli        | Delegated via `getToolDefinitions()`               |
| `run_command`           | boxel-cli        | Delegated via `getToolDefinitions()`               |
| `create_realm`          | boxel-cli        | Delegated via `getToolDefinitions()`               |
| `run_tests`             | software-factory | Manual — factory-specific Playwright orchestration |
| `signal_done`           | software-factory | Manual — control flow signal to ralph loop         |
| `request_clarification` | software-factory | Manual — control flow signal to ralph loop         |

All retired tools (`write_file`, `read_file`, `search_realm`, `update_ticket`, `update_project`, `create_knowledge`, `create_catalog_spec`, `realm-read`, `realm-write`, `realm-delete`) are gone — replaced by native LLM file I/O + `boxel sync`.

## Open Questions

- **Issue creation during execution**: Can the agent create new issues mid-loop (e.g., "I found a bug, creating a fix issue")? This is powerful but needs guardrails to prevent issue explosion.
- **Parallel execution**: Can multiple non-dependent issues execute in parallel? Phase 2 starts serial, but the issue graph naturally supports parallelism.
- **Max iterations per issue**: Should this be a property on the issue, or a global default? Some issues (test execution) may need more retries than others.
- **Issue type taxonomy**: What's the minimal set of issue types? Candidates: `implement`, `test-write`, `test-execute`, `bootstrap`, `knowledge`, `review`.
- **Failure escalation**: When an issue fails after max retries, should it block dependents automatically, or should the agent decide?
- **Workspace lifecycle**: When the factory creates a new target realm and syncs it locally, where does the local workspace live? Options: a temp directory (cleaned up on exit), a stable path under `.claude/worktrees/`, or a user-specified path.
- **Concurrent realm writes**: If the agent writes files locally while `boxel track --push` is running, how do we prevent partial pushes? Options: write-then-sync (no track), edit locks, or batched sync after agent exits.

## Relationship to architecture.md

The sequence diagram in `architecture.md` shows the target state:

```
loop Until no unblocked issues left (or max iterations reached)
    Factory->>ClaudeCodeCLI: Invoke With Prompt
    ClaudeCodeCLI->>HostedBoxel: Work issue and update issue status when done
```

Phase 2 implements exactly this. The "Factory" is the thin orchestrator/scheduler. "ClaudeCodeCLI" is the `LoopAgent`. "HostedBoxel" is the realm accessed via `FactoryTool[]` and local workspace sync. The issue selection, dependency resolution, and status updates are the orchestrator's only responsibilities.

With boxel-cli integration, "HostedBoxel" is accessed through a synced local workspace rather than direct HTTP calls — the agent works on local files and boxel-cli handles the synchronization. This matches how human developers use Boxel: edit locally, sync to server.

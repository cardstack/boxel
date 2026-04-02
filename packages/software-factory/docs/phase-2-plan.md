# Phase 2: Issue-Driven Agentic Loop

## Context

Phase 1 (`one-shot-factory-go-plan.md`) implements a fixed pipeline: intake → bootstrap → implement → test → iterate. This works for the first pass but hard-codes the loop structure and the relationship between implementation and testing.

Phase 2 moves to an **issue-driven loop** aligned with the target architecture in `architecture.md`. The orchestrator becomes a thin scheduler that picks the next issue and delegates everything — including bootstrap, implementation, test creation, and test execution — to the agent via the issue tracking system.

## Core Idea

The factory loop iterates over **issues in the project**, one at a time. Each issue describes a unit of work the agent should complete. The orchestrator's only job is:

1. Select the next unblocked issue (based on ordering / dependency rules)
2. Hand it to the agent
3. Wait for the agent to exit
4. Read updated issue state and repeat

The agent always exits the same way — the orchestrator reads the issue's updated status/tags to decide what happened. If the agent tagged the issue as blocked (e.g., needs human clarification), the orchestrator skips it and moves on. If the issue is marked done, the orchestrator advances. This keeps the agent's exit path uniform — it doesn't need a separate "blocked" signal in its return type, it just updates the issue and exits.

This makes the loop generic. It doesn't need to know whether an issue is "implement a card", "write tests", "create the project spec", or "break down the brief into tickets". The agent reads the issue, does the work, updates the issue status, and exits.

## Issue Ordering and Dependencies

Issues need properties that let the orchestrator determine execution order. Possible fields (may use a combination):

- **priority** — numeric or enum, lower = execute first
- **predecessors / blockedBy** — explicit dependency edges; an issue cannot start until its blockers are done
- **order** — explicit sequence number for tie-breaking

The selection algorithm:

1. Filter to issues with status `ready` or `in_progress`
2. Exclude issues whose `blockedBy` list contains any non-completed issue
3. Sort by priority (ascending), then by order (ascending)
4. Pick the first one

Resume semantics: if an issue is already `in_progress`, it takes priority over `ready` issues (the factory was interrupted and should continue where it left off).

## Tests as Issues, Not Loop Phases

In phase 1, test execution is a hard-coded step after the agent signals done. In phase 2, tests are just another issue type.

During task breakdown, the agent creates issues like:

- "Implement StickyNote card definition" (type: implement)
- "Create sample StickyNote instances" (type: implement)
- "Write Playwright tests for StickyNote" (type: test)
- "Run Playwright tests for StickyNote" (type: test-execution)

The test-execution issue has `blockedBy` pointing to the implementation and test-writing issues. When the orchestrator picks it up, the agent (or orchestrator) runs the test suite. If tests fail, the orchestrator can:

- Reopen the implementation issue with failure context
- Create a new fix issue that blocks a re-run of the test-execution issue
- Let the agent decide how to handle the failure (more flexible)

This removes the assumption that every implementation issue has a test phase. Some issues (e.g., "create knowledge article") may not need tests. Others (e.g., "run full regression") are pure test issues.

### Completion Rule for Test Issues

A test-execution issue is not considered done until all tests pass. If tests fail, the agent iterates — but the iteration is modeled as issue state transitions rather than a hard-coded retry loop in the orchestrator.

## Bootstrap as Part of the Agentic Loop

In phase 1, bootstrap (creating the Project, KnowledgeArticles, and initial Tickets) is a separate orchestrator phase that runs before the loop. In phase 2, bootstrap is itself driven by issues.

The flow becomes:

1. Factory starts with a brief URL and a target realm
2. The orchestrator creates a single **seed issue**: "Process brief and create project artifacts"
3. The agent picks up this seed issue, reads the brief, and creates:
   - The Project card
   - KnowledgeArticle cards
   - The initial set of implementation and test issues
4. The agent marks the seed issue as done
5. The orchestrator now has a populated issue backlog and continues the normal loop

This is the "quirk" where an issue's job is to create the project itself. But it's a natural fit — the LLM participates in brief processing and task breakdown as part of the loop, not as a separate hard-coded phase. This was already identified as a goal (the plan mentions LLM participation in brief processing / artifact creation).

### Benefits

- The LLM can ask clarifying questions during bootstrap (by tagging the seed issue as blocked)
- Task breakdown quality improves because the LLM sees the full brief context and can make judgment calls
- The bootstrap process is testable with the same MockFactoryAgent pattern used for implementation issues
- Resume works naturally — if the factory crashes during bootstrap, the seed issue is still `in_progress` and gets picked up on restart

## Orchestrator Simplification

The phase 2 orchestrator becomes much thinner:

```
while (hasUnblockedIssues()) {
  let issue = pickNextIssue();
  await agent.run(contextForIssue(issue), tools);
  // Agent updates issue status/tags directly, then exits.
  // Orchestrator reads the issue state to decide what happened.
  refreshIssueState(issue);
}
```

The agent signals completion by updating the issue — tagging it as blocked, marking it done, etc. The orchestrator doesn't inspect a return value for status; it reads the issue state from the realm after the agent exits. All domain logic (what to implement, how to test, when to create sub-issues, when to tag as blocked) lives in the agent's prompt and skills, not in the orchestrator code.

## Issue Lifecycle

```
created → ready → in_progress → done
                → blocked (needs human input)
                → failed (max retries exceeded)
```

The agent manages its own transitions by updating the issue directly (e.g., tagging as blocked, marking done). The orchestrator reads the issue state after the agent exits to decide what to do next — it does not inspect the agent's return value for status.

## Migration Path from Phase 1

Phase 1 and phase 2 can coexist:

1. Phase 1 ships with the hard-coded pipeline (`factory-loop.ts`)
2. Phase 2 introduces an `IssueScheduler` that replaces the fixed loop with issue-driven scheduling
3. The `LoopAgent` interface (`run(context, tools)`) stays the same — only the orchestrator changes
4. `ContextBuilder` gains an issue-aware mode that builds context from the current issue rather than a fixed ticket
5. The `TestRunner` callback becomes a tool the agent can call, rather than a loop phase

The `FactoryTool[]` type from phase 1 carries forward unchanged. `AgentRunResult` may be simplified — in phase 2 the agent signals completion by updating the issue (tagging as blocked, marking done), so the orchestrator reads issue state rather than inspecting a return status. The agent just needs to exit; the orchestrator figures out what happened from the issue.

## Open Questions

- **Issue creation during execution**: Can the agent create new issues mid-loop (e.g., "I found a bug, creating a fix issue")? This is powerful but needs guardrails to prevent issue explosion.
- **Parallel execution**: Can multiple non-dependent issues execute in parallel? Phase 2 starts serial, but the issue graph naturally supports parallelism.
- **Max iterations per issue**: Should this be a property on the issue, or a global default? Some issues (test execution) may need more retries than others.
- **Issue type taxonomy**: What's the minimal set of issue types? Candidates: `implement`, `test-write`, `test-execute`, `bootstrap`, `knowledge`, `review`.
- **Failure escalation**: When an issue fails after max retries, should it block dependents automatically, or should the agent decide?

## Relationship to architecture.md

The sequence diagram in `architecture.md` shows the target state:

```
loop Until no unblocked issues left (or max iterations reached)
    Factory->>ClaudeCodeCLI: Invoke With Prompt
    ClaudeCodeCLI->>HostedBoxel: Work issue and update issue status when done
```

Phase 2 implements exactly this. The "Factory" is the thin orchestrator/scheduler. "ClaudeCodeCLI" is the `LoopAgent`. "HostedBoxel" is the realm accessed via `FactoryTool[]`. The issue selection, dependency resolution, and status updates are the orchestrator's only responsibilities.

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

## Boxel-CLI Integration

Phase 1 communicates with realms exclusively through HTTP API calls (`realm-operations.ts`) because boxel-cli lacked JWT auth support. Phase 2 integrates boxel-cli as a first-class monorepo package and uses it as the primary realm I/O layer, replacing the HTTP stopgap.

### Why Boxel-CLI Changes Everything

When boxel-cli is available as a local tool, the agent gains a **synced local workspace** — a directory on the filesystem that mirrors a realm. This is a fundamental shift:

- **The LLM already knows filesystem tools.** Every coding LLM is fluent with `cat`, `grep`, `ls`, `rm`, file writes, etc. By syncing a realm to a local directory, the agent can inspect and manipulate realm contents using the filesystem tools it's most proficient with — no custom `read_file` / `write_file` / `search_realm` wrapper tools needed for basic operations.
- **Batch writes become trivial.** Write 10 files locally, then `boxel sync . --prefer-local` to push them all at once. No need for `realm-atomic` batching or per-file HTTP POST calls.
- **Existing CLI skills become usable.** The 6 CLI skills (`boxel-sync`, `boxel-track`, `boxel-watch`, `boxel-restore`, `boxel-repair`, `boxel-setup`) that were excluded in phase 1 become available to the factory agent.
- **Test file authoring is natural.** The agent writes `.spec.ts` files to a local directory, and Playwright runs them directly — no need to pull test files from a remote realm to a temp directory first.

### Monorepo Integration (CS-10520)

Boxel-cli currently lives in a separate repository (`cardstack/boxel-cli`). Phase 2 moves it into the Boxel monorepo as `packages/boxel-cli`:

1. **Import the package** into `packages/boxel-cli` with its existing source, tests, and build configuration
2. **Wire it into the monorepo** — add it to the pnpm workspace, ensure it builds alongside other packages
3. **Make it a dependency** of `packages/software-factory` so factory scripts can import CLI utilities directly (e.g., sync logic, auth helpers) rather than shelling out to `npx boxel`
4. **Preserve the standalone CLI** — `npx boxel` and `npm install -g boxel-cli` must continue to work for human users

Being in the monorepo means:

- Changes to boxel-cli and the factory can land in the same PR
- The factory's CI runs against the exact boxel-cli version it depends on
- Shared types and utilities can be extracted to `runtime-common` instead of being duplicated

### Flexible Auth Support (CS-10529)

Phase 1's boxel-cli lacks the auth flexibility the factory needs. The factory creates new realms on the fly and immediately needs to read/write to them — but boxel-cli's profile-based auth only knows about realms the user has manually configured.

CS-10529 extends boxel-cli auth to support:

1. **`--jwt <token>` flag** on `boxel pull`, `boxel push`, `boxel sync`, and `boxel status` — allows passing a per-realm JWT directly instead of relying on profile-based auth. This is essential for factory-created realms that don't exist in any profile.
2. **`--realm-server-jwt <token>` flag** on `boxel create` — allows creating realms with a server-level JWT obtained via `matrixLogin()` + `getRealmServerToken()`.
3. **Programmatic auth API** — export auth helpers from boxel-cli so the factory can call `createAuthenticatedSync(realmUrl, jwt)` directly, without spawning a subprocess.
4. **Token refresh callback** — allow callers to provide a function that refreshes expired JWTs, so long-running sync operations don't fail mid-stream.

### Realm Creation via Boxel-CLI

Phase 1 creates realms by calling `POST /_create-realm` directly. Phase 2 moves this to boxel-cli:

```bash
boxel create realm --name "Sticky Notes" --endpoint "user/sticky-notes" \
  --realm-server-url http://localhost:4201/ \
  --realm-server-jwt "$SERVER_JWT"
```

This means the agent can create realms using the same tool interface as all other CLI operations. The factory's `factory-target-realm.ts` becomes a thin wrapper that calls boxel-cli rather than making raw HTTP requests.

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

#### What Stays as Realm API Tools

Some operations are inherently server-side and cannot be replaced by local file I/O:

- **`realm-search`** — structured queries against the realm index (type filters, field queries, sorting)
- **`realm-create`** — creating new realms (until boxel-cli absorbs this)
- **`realm-server-session`** / **`realm-auth`** — JWT management
- **`pick-ticket`** — ticket queries that filter by status, priority, agent

#### Tool Registry Changes

The `ToolRegistry` in phase 2 includes all three categories:

```typescript
// Phase 1: only SCRIPT_TOOLS + REALM_API_TOOLS
// Phase 2: all tools available
let allManifests = [...SCRIPT_TOOLS, ...BOXEL_CLI_TOOLS, ...REALM_API_TOOLS];
```

`BOXEL_CLI_TOOLS` (`boxel-sync`, `boxel-push`, `boxel-pull`, `boxel-status`, `boxel-create`, `boxel-history`) become available to the agent. The factory-level wrapper tools (`write_file`, `read_file`, `search_realm`) can be retired or kept as convenience aliases that delegate to the filesystem + sync.

#### Skill Re-enablement

The 6 CLI skills excluded in phase 1 (`boxel-sync`, `boxel-track`, `boxel-watch`, `boxel-restore`, `boxel-repair`, `boxel-setup`) are re-enabled in the skill resolver. The `CLI_ONLY_SKILLS` exclusion list in `factory-skill-loader.ts` is removed, and the keyword-based CLI skill resolution logic is restored.

### Migration Strategy

The refactor happens in stages to avoid a big-bang rewrite:

1. **Stage 1: Monorepo import** — Move boxel-cli into `packages/boxel-cli`. All existing factory code continues to use HTTP-based realm operations unchanged.
2. **Stage 2: Auth extension (CS-10529)** — Add `--jwt` flag support and programmatic auth API to boxel-cli. Factory tests verify that `boxel pull --jwt` and `boxel sync --jwt` work with factory-created realm tokens.
3. **Stage 3: Sync-based workspace** — Factory entrypoint syncs the target realm to a local workspace before starting the agent loop. Agent writes files locally. A post-iteration sync pushes changes to the realm.
4. **Stage 4: Retire HTTP wrappers** — Remove `realm-operations.ts` stopgap functions (`writeModuleSource`, `readCardSource`, `writeCardSource`, `pullRealmFiles`). Replace with boxel-cli calls. Keep `searchRealm` for structured queries.
5. **Stage 5: Re-enable CLI skills** — Remove the `CLI_ONLY_SKILLS` filter from the skill resolver. Update CLI skill content to reference the `--jwt` flag for factory-context auth.

### Impact on `factory-tool-builder.ts`

The factory-level tools evolve:

| Phase 1 Tool            | Phase 2 Replacement                      | Notes                                                    |
| ----------------------- | ---------------------------------------- | -------------------------------------------------------- |
| `write_file`            | Filesystem write + `boxel sync`          | Agent writes to local workspace                          |
| `read_file`             | Filesystem read (`cat`)                  | Agent reads from local workspace                         |
| `search_realm`          | `grep`/`find` + `realm-search`           | Local search for files, realm API for structured queries |
| `update_ticket`         | Filesystem write + `boxel sync`          | Or keep as realm-api tool for immediate server update    |
| `update_project`        | Filesystem write + `boxel sync`          | Or keep as realm-api tool for immediate server update    |
| `create_knowledge`      | Filesystem write + `boxel sync`          | Agent writes JSON to local workspace                     |
| `run_tests`             | Playwright runs against local spec files | No need to pull from realm first                         |
| `signal_done`           | Agent updates issue status directly      | Signals via issue state, not return type                 |
| `request_clarification` | Agent tags issue as blocked              | Signals via issue state                                  |

Tools like `update_ticket` and `update_project` may be kept as convenience tools that write directly to the realm API for status updates that need to be immediately visible — but the bulk of file I/O moves to the filesystem.

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

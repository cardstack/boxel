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
- **Lint step** (CS-10714): `{ lintResultId, filesChecked, filesWithErrors, totalViolations, violations: [{ rule, file, line, message }] }` — calls the realm's `_lint` endpoint (ESLint + Prettier + `@cardstack/boxel` rules) for each `.gts`, `.gjs`, `.ts`, `.js` file. Creates a `LintResult` card as a persistent artifact.
- **Eval step** (CS-10715): `{ evalResultId, modulesChecked, modulesWithErrors, modules: [{ path, error, stackTrace? }] }` — evaluates each non-test `.gts` module via `_run-command` → `evaluate-module` host command → `/_prerender-module` (prerenderer sandbox). Creates an `EvalResult` card as a persistent artifact. Files matching `*.test.gts` are excluded.
- **Instantiate step** (CS-10716): `{ instantiateResultId, cardsChecked, cardsWithErrors, cards: [{ specId, cardName, error, stackTrace? }] }` — discovers Spec cards in the realm, resolves each spec's `ref` to a card definition module, reads `linkedExamples` entries as instance data, and instantiates via `_run-command` → `instantiate-card` host command → `store.__dangerousCreateFromSerialized(...)` (prerenderer sandbox) so `Field.validate()` failures surface during instantiation. Creates an `InstantiateResult` card as a persistent artifact. Field specs (`specType: 'field'`) are excluded.
- **Parse step** (CS-10713): `{ parseResultId, filesChecked, filesWithErrors, totalErrors, errors: [{ file, line, message }] }` — validates `.gts`/`.ts` files by running `ember-tsc --noEmit` (glint) for template-aware TypeScript type checking, and validates `.json` card instances via structural validation (JSON syntax + card document shape). JSON validation runs against spec `linkedExamples` — same discovery as the instantiate step. Creates a `ParseResult` card as a persistent artifact.

**Adding a new validation step** = creating a new module file in `src/validators/` + wiring it into `createDefaultPipeline()`.

### Validation Artifacts: Naming and Storage

All validation artifacts (test runs, lint results, future validation types) are stored in a shared `Validations/` directory in the target realm with type-prefixed names:

- Parse results: `Validations/parse_{issue-slug}-{seq}.json` (e.g., `Validations/parse_sticky-note-define-core-1.json`)
- Test runs: `Validations/test_{issue-slug}-{seq}.json` (e.g., `Validations/test_sticky-note-define-core-1.json`)
- Lint results: `Validations/lint_{issue-slug}-{seq}.json` (e.g., `Validations/lint_sticky-note-define-core-1.json`)
- Eval results: `Validations/eval_{issue-slug}-{seq}.json` (e.g., `Validations/eval_sticky-note-define-core-1.json`)
- Instantiate results: `Validations/instantiate_{issue-slug}-{seq}.json` (e.g., `Validations/instantiate_sticky-note-define-core-1.json`)

Each artifact is a card instance (`ParseResult`, `TestRun`, `LintResult`, `EvalResult`, or `InstantiateResult`) with `linksTo` relationships to the `Issue` and `Project` being validated.

### Validation Context Flow

`Validator.formatForContext()` is the **sole mechanism** for getting validation results into the LLM context:

1. After each agent turn, `validator.validate(targetRealmUrl)` produces `ValidationResults` (used by the loop for pass/fail control flow)
2. `validator.formatForContext(results)` produces combined markdown from all step runners
3. This pre-formatted string is stored as `validationContext` on `AgentContext` and rendered in the `ticket-iterate.md` template
4. The LLM never sees the raw `ValidationResults` struct — only the formatted markdown

The Phase 1 `testResults` field on `AgentContext` is deprecated. All validation flows through `validationResults` (for the loop) and `validationContext` (for the LLM prompt).

### Parse Step Details (CS-10713)

The parse validation step (`src/validators/parse-step.ts`) verifies that `.gts`, `.ts`, and `.json` files are valid. It replaces the `NoOpStepRunner('parse')` placeholder in the default pipeline. For `.gts`/`.ts` files it uses glint (`ember-tsc`) for full template-aware TypeScript type checking. For `.json` files it validates card document structure.

**GTS/TS validation uses glint (ember-tsc):**

The step downloads realm `.gts` and `.ts` files to a temp directory, writes a tsconfig.json (mirroring `realm/tsconfig.json` with absolute paths to `packages/base`), symlinks the software-factory `node_modules` (so glint's internal `@glint/ember-tsc/-private/dsl` module resolves), and runs `ember-tsc --noEmit`. This catches:

- TypeScript type errors (type mismatches, missing properties, bad assignments)
- Template errors (invalid component args, missing helpers, malformed template expressions)
- Syntax errors (missing brackets, unterminated strings, malformed type annotations)

**Filtering:** The base package has pre-existing type errors (e.g., `<style scoped>` not in HTML type definitions, missing `@ember/*` module declarations). The step filters output to only errors from the temp directory and suppresses known false positives: TS2353 for `'scoped'` on `<style>` elements (Ember's `<style scoped>` is valid but not in the HTML type definitions).

**Test files excluded:** Files matching `*.test.gts` or `*.test.ts` are excluded — test files require QUnit and `@universal-ember/test-support` type declarations that aren't available in the parse step's isolated temp directory. Test file correctness is the test validation step's responsibility. `.js` files are also excluded because lint (ESLint) already validates JavaScript syntax and the factory agent does not generate `.js` files.

**JSON validation uses spec-based discovery** — the same mechanism as the instantiate step. The step searches the realm for Spec cards and extracts their `linkedExamples` URLs, then reads each example instance and validates:

1. JSON syntax via `JSON.parse()` (when reading raw content from mocks or non-realm sources)
2. Card document structure: presence of `data` object, `data.type` string, `data.meta.adoptsFrom` with `module` and `name`

When `readFile` returns a parsed `document` (as the realm API does for `.json` files), JSON syntax is already validated — only the structural check runs. When the realm enriches the document during indexing, the structural check validates the enriched version, which may pass even if the raw source was incomplete. This is intentional: if the realm accepted and indexed the card, it is valid from the realm's perspective.

**Bootstrap behavior:** When no `.gts`/`.ts` files exist and no Spec cards are found (bootstrap scenario), the step returns `passed: true` with no files checked and no artifact created. This matches the design principle: "nothing to validate is a pass."

**Performance:** The tsconfig content is cached in memory (it never changes between runs). The `node_modules` symlink avoids copying hundreds of megabytes of dependencies.

**Shared engine.** The discovery, glint invocation, and per-file parse loop live in `src/parse-execution.ts` (`discoverParseableGtsFiles` + `discoverJsonExampleFiles` + `parseRealmFiles`, plus the glint runner and JSON validators). Both the validation pipeline's `ParseValidationStep` (which owns `ParseResult` artifact lifecycle) and the in-memory `run_parse` agent tool (see below) consume the same engine, so parse coverage stays identical.

### In-Memory `run_parse` Agent Tool (CS-10778)

The agent also has a `run_parse` tool exposed on the factory tool set. It runs the same discovery + glint / JSON engine as the validation step and returns a flat, JSON-friendly `RunParseResult` (`status`, `filesChecked`, `filesWithErrors`, `errorCount`, `durationMs`, `parseableFiles`, `errors[{ file, line, column, message }]`). Unlike `ParseValidationStep`, it **does not create a `ParseResult` card** — no realm artifact is written, so it's safe to call repeatedly for mid-turn self-validation before `signal_done`. The orchestrator's post-`signal_done` parse validation still writes the durable `ParseResult`.

The tool accepts an optional `path` argument. When omitted, every `.gts` / `.gjs` / `.ts` file in the realm is type-checked AND every `.json` file listed as a Spec `linkedExample` is validated (matching the validation step's behavior). When supplied, the tool skips discovery and parses only that one realm-relative file — `.gts` / `.gjs` / `.ts` runs through glint; `.json` is parsed and checked for card document structure. Paths with non-parseable extensions (`.md`, etc.) short-circuit to `status: 'error'` without calling the realm.

The `ParseResult` card definition (`realm/parse-result.gts`) and CRUD (`src/parse-result-cards.ts`) follow the same patterns as `LintResult` and `EvalResult` — fitted/embedded/isolated templates, a running state, `ParseFileResult` field def with nested `ParseError` entries, and links to Issue/Project.

### Lint Step Details (CS-10714)

The lint validation step (`src/validators/lint-step.ts`) uses the realm's existing `_lint` endpoint — the same one the Monaco editor uses in code mode. For each lintable file discovered in the realm:

1. Read the file source via `readFile()`
2. POST the source to `{realmUrl}_lint` with `X-Filename` header
3. ESLint runs with `@cardstack/boxel` rules (missing invokables, missing card-api imports, no-duplicate-imports, etc.) and Prettier formatting
4. Collect `messages` from the response where `severity === 2` (errors)

The `LintResult` card definition (`realm/lint-result.gts`) mirrors the `TestRun` card structure with fitted/embedded/isolated templates, a running state, and links to Issue/Project. Card CRUD is in `src/lint-result-cards.ts`.

**Shared engine.** The per-file discovery and lint loop live in `src/lint-execution.ts` (`discoverLintableFiles` + `lintRealmFiles`). Both the validation pipeline's `LintValidationStep` (which owns `LintResult` artifact lifecycle) and the in-memory `run_lint` agent tool (see below) consume the same engine, so rule coverage and read/lint semantics stay identical.

### In-Memory `run_lint` Agent Tool (CS-10776)

The agent also has a `run_lint` tool exposed on the factory tool set. It runs the same discovery + `_lint` engine as the validation step and returns a flat, JSON-friendly `RunLintResult` (`status`, `filesChecked`, `filesWithErrors`, `errorCount`, `warningCount`, `durationMs`, `lintableFiles`, `violations[{ rule, file, line, column, message, severity }]`). Unlike `LintValidationStep`, it **does not create a `LintResult` card** — no realm artifact is written, so it's safe to call repeatedly for mid-turn self-validation before `signal_done`. The orchestrator's post-`signal_done` lint validation still writes the durable `LintResult`.

The tool accepts an optional `path` argument. When omitted, every lintable file in the realm is linted (matching the validation step's behavior). When supplied, the tool skips discovery and lints only that one realm-relative file — handy for a fast self-check right after writing or editing a single file. Paths with non-lintable extensions (`.json`, etc.) short-circuit to `status: 'error'` without calling the realm.

### Eval Step Details (CS-10715)

The eval validation step (`src/validators/eval-step.ts`) verifies that `.gts` modules load and evaluate without runtime errors. Module evaluation must happen in a sandbox — the prerenderer's headless Chrome — never directly in the factory's Node process. The step chains through three layers: `_run-command` → `evaluate-module` host command (`packages/host/app/commands/evaluate-module.ts`) → `/_prerender-module` endpoint. The prerenderer returns a `ModuleRenderResponse` with `status: 'ready' | 'error'` and structured error details including message and stack trace.

For each non-test `.gts` file discovered in the realm (files matching `*.test.gts` are excluded — test files are the test step's responsibility):

1. Construct the module URL (strip `.gts` extension, resolve against realm URL)
2. Call the `evaluate-module` host command via `runRealmCommand()`
3. The host command calls `/_prerender-module` on the realm server
4. The prerenderer evaluates the module in headless Chrome and returns success/error
5. Collect errors with module path, error message, and optional stack trace

The `EvalResult` card definition (`realm/eval-result.gts`) follows the same structure as `LintResult` and `TestRun` — fitted/embedded/isolated templates, a running state, and links to Issue/Project. Card CRUD is in `src/eval-result-cards.ts`. Sequence numbers use the shared `getNextValidationSequenceNumber()` from `realm-operations.ts`.

### Instantiate Step Details (CS-10716)

The instantiate validation step (`src/validators/instantiate-step.ts`) verifies that card definitions can produce live instances from JSON. This catches errors that the eval step misses — eval only verifies modules _load_ (via `loader.import()`), instantiate verifies cards can be _created from JSON_ (via `store.__dangerousCreateFromSerialized(...)`). The step chains through: `_run-command` → `instantiate-card` host command (`packages/host/app/commands/instantiate-card.ts`) → store-based instantiation in the prerenderer sandbox.

**Discovery is spec-based, not file-based.** Unlike eval (which discovers all `.gts` files), the instantiate step searches for `Spec` cards in the realm using `searchRealm()` with the canonical `specRef` (`https://cardstack.com/base/spec`). This aligns with the factory's "one issue per entrypoint card" model where each entrypoint has a matching Spec. Field specs (`specType: 'field'`) are excluded. Each Spec's `ref` field identifies the card definition module and exported class name.

**All `linkedExamples` are instantiated, not just the first.** For each Spec, the step reads every entry in the `linkedExamples` relationship (using the Boxel dotted-key format `linkedExamples.0`, `linkedExamples.1`, etc.), resolves relative `adoptsFrom.module` paths to absolute URLs using `codeRefWithAbsoluteIdentifier` logic, and instantiates all examples in parallel via `Promise.allSettled`. If a Spec has no linked examples, the host command builds a minimal document with just `adoptsFrom` and empty attributes — this still validates that the card class can be loaded and an empty instance deserialized.

**Missing specs is a failure when card modules exist.** During bootstrap (no `.gts` modules, no Specs), the step passes vacuously with no artifact created. But when non-test `.gts` card modules exist and no Spec cards are found, the step fails with an actionable error: "Each entrypoint card needs a Catalog Spec with linkedExamples for instantiation validation." This ensures the agent creates Specs as part of each implementation issue. The `InstantiateResult` artifact is only created when there are Specs to validate — no empty artifacts are written for bootstrap issues.

The host command uses `store.__dangerousCreateFromSerialized(...)` — a public method we added to `StoreService` that calls `card-api.createFromSerialized` directly. We initially tried the public API (`store.add(doc, { doNotPersist: true })`) but discovered that `store.add()` relaxes serialization errors: `Field.validate()` failures during deserialization are caught internally and logged as console warnings rather than thrown. This is correct behavior for the UI (a broken card should degrade gracefully), but the factory needs those validation errors to propagate as thrown exceptions so they can be reported to the agent as actionable failures. The `__dangerous` prefix signals that callers should not use this method for normal store operations — it bypasses persistence, identity mapping, and auto-saving. Auth token routing follows the same pattern as the eval step. The `InstantiateResult` card definition (`realm/instantiate-result.gts`) and CRUD (`src/instantiate-result-cards.ts`) follow the same patterns as `EvalResult`.

### Transpiled-Source Debugging for Runtime Errors (CS-10806)

Eval and instantiate validation errors carry line/column references that point to **transpiled** module output, not the `.gts` source the agent wrote. The realm server compiles `.gts` to JS before executing modules in the prerenderer sandbox, and the runtime error frames reference the compiled output. For example, a CSS-comment bug in the source often surfaces as `" is not a valid character within attribute names: (error occurred in '/.../sticky-note.gts' @ line 66 : column 32)` — line 66 points inside a `precompileTemplate(...)` block in the transpiled module, not line 66 of the source.

The agent has a `fetch_transpiled_module` factory tool that GETs the module URL with `Accept: */*` (compared to `read_file` which uses `application/vnd.card+source` for the raw `.gts`). The underlying call is `BoxelCLIClient.readTranspiled(realmUrl, path)` in `packages/boxel-cli` — it returns the compiled JS as text, and the realm accepts the path with or without the `.gts` extension. The `software-factory-operations` skill teaches the agent to recognize line/column references in eval/instantiate failures and reach for this tool when debugging. The agent still edits the `.gts` source — the transpiled output is regenerated on every write.

**Rationale:** This path was chosen over source-map correlation or rewriting prerenderer error messages in the validation pipeline. Keeping the validation steps untouched and pushing the debugging affordance to the agent's toolbelt + skill is simpler, scoped to the agent's workflow, and avoids coupling the validator to transpiler internals.

### Handling Failures

Validation failures are fed back to the agent as context in the **next inner-loop iteration**. The orchestrator does not create fix issues for validation failures — it iterates with the failure details so the agent can self-correct. This mirrors Phase 1's approach (feed test results back, iterate) but with a broader validation pipeline.

The inner loop continues until:

- The agent marks the issue as done (all validation passes)
- The agent marks the issue as blocked (needs human input)
- Max iterations are reached with **failing validation** — the orchestrator blocks the issue with the reason ("max iteration limit reached") and the formatted validation failure context in the issue description, then moves to the next issue
- Max iterations are reached with **passing validation** — the issue is exhausted but not blocked (agent did not mark done despite passing validation)

The agent always has the option to create new issues via tool calls if it determines that a failure requires separate work (e.g., "this card definition depends on another card that doesn't exist yet — creating a new issue for it"). But the orchestrator does not force this — the agent decides.

### Retrying Blocked Issues (default on, opt out with `--no-retry-blocked`)

By default, the factory resets eligible blocked issues to `backlog` with `critical` priority before running the loop:

- **Only issues blocked without `blockedBy` dependencies are reset** — issues blocked by another issue (dependency) are left alone. This distinguishes "blocked by validation failures" from "blocked by unfinished prerequisite work."
- **Priority elevation to `critical`** ensures retried issues are picked up before other backlog items by `IssueScheduler.pickNextIssue()`.
- **A comment is added** documenting the reset for traceability.
- **Prior validation failure context in issue comments is preserved** — the agent sees what went wrong and has context for the retry.
- **Opt out with `--no-retry-blocked`** — if you want blocked issues to stay blocked, pass this flag.

### What This Means for Task Breakdown

During task breakdown, the agent organizes implementation issues around **entry-point cards** — the top-level cards users interact with directly and that should be discoverable in the Boxel catalog. The agent creates **one issue per entry-point card**, where each issue covers:

- The card definition (`.gts`) and any interior/support cards it depends on
- QUnit tests (`.test.gts`) for the entry-point card and all its support cards
- A Catalog Spec (`Spec/<card-name>.json`) with realistic example instances linked via `linkedExamples`

Interior cards (field cards, helper cards, linked supporting types) are implemented as part of their entry-point card's issue. They need tests but do not need their own catalog specs or separate issues.

If the brief describes only one entry-point card, there will be one implementation issue. If it describes multiple, there will be one per entry-point card. Issues are ordered so that **dependency cards are implemented before cards that consume them** — if card B uses card A as a field type or linked card, card A's issue gets a lower `order` and card B's issue has `blockedBy` pointing to card A's issue. This ensures the agent builds foundational cards first.

Each implementation issue must carry `project` and `relatedKnowledge` relationships pointing to the Project and KnowledgeArticle cards created during bootstrap. This is how `ContextBuilder.buildForIssue()` loads project scope and brief context for the agent when working on these issues.

The agent does **not** need to create "run tests" issues. Test execution happens automatically as part of the validation phase after every inner-loop iteration. The agent may also call the `run_tests` tool mid-turn for in-memory self-validation (see "run_tests Tool: In-Memory Validation" below) — that call is optional and never replaces the orchestrator's post-turn pipeline.

### Validation Behavior for Bootstrap Issues

Bootstrap issues (the seed issue that creates Project, KnowledgeArticles, and implementation issues) produce no testable code artifacts — only JSON card instances. Validation still runs after every inner-loop iteration, but each step gracefully handles "nothing to validate":

| Step                   | Bootstrap behavior                                                              |
| ---------------------- | ------------------------------------------------------------------------------- |
| **Parse**              | Checks `.gts` syntax + `.json` spec examples — pass if no specs or `.gts` files |
| **Lint**               | No-op for JSON card instances — pass                                            |
| **Module evaluation**  | No `.gts` modules created — no-op, pass                                         |
| **Card instantiation** | No `.gts` modules or Spec cards — pass, no artifact created                     |
| **Run tests**          | No test files exist yet — vacuous pass                                          |

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

Seed issue creation is **idempotent** — `createSeedIssue()` checks if `Issues/bootstrap-seed` already exists before writing. This supports crash recovery: if the factory restarts, the seed issue is already in the realm and the loop picks it up. Because of this idempotency, the `--mode` flag (bootstrap / implement / resume) was removed from the CLI — there is no need to distinguish between a fresh run and a resume. The factory always creates the seed (no-op if it already exists) and runs the issue loop.

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

### run_tests Tool: In-Memory Validation (CS-10777)

The `run_tests` tool **is exposed** to the agent, but as an **in-memory** validator rather than a realm-writing one. This is the first member of the `CS-10775` in-memory validation tool family (with in-memory `lint`, `parse`, and `evaluate` counterparts coming as sibling issues).

Behavior:

- The tool discovers `*.test.gts` files in the target realm, drives QUnit via Playwright/Chromium (through the shared `runQunitInBrowser()` engine), and returns a flat `RunTestsResult` object — `{ status, passedCount, failedCount, skippedCount, durationMs, testFiles, failures, errorMessage? }`.
- It does **not** create a `TestRun` card or any other realm artifact. The orchestrator's post-`signal_done` validation pipeline still writes the durable `TestRun` artifact.
- It takes no arguments — it always runs the full `*.test.gts` set in the target realm.

Rationale for reintroduction: the original `run_tests` tool was removed because it ran through `executeTestRunFromRealm()`, which meant the agent could create duplicate `TestRun` instances and confuse sequence-number ordering. The in-memory variant sidesteps that problem entirely — no card is ever written — so letting the agent call it mid-turn to check its own work is safe. The pipeline remains the source of truth for the persistent `TestRun` artifact.

### run_evaluate: In-Memory Self-Validation (CS-10779)

The `run_evaluate` tool lets the agent evaluate one (or every non-test) ESM module in the target realm via the prerenderer sandbox and get back a flat `RunEvaluateResult` (`status`, `modulesChecked`, `modulesWithErrors`, `durationMs`, `evaluableFiles`, `failures: { path, error, stackTrace? }[]`). Unlike the pipeline's `EvalValidationStep`, it does NOT write an `EvalResult` card — so the agent can call it mid-turn as many times as it likes without creating realm artifacts. The orchestrator still runs the full validation pipeline (which writes the durable `EvalResult` card) after `signal_done`, so calling this tool is optional.

Discovery (all non-test `.gts` / `.gjs` / `.ts` / `.js` files, alphabetical) and per-module evaluation now live in the shared `src/eval-execution.ts` engine, used by both `EvalValidationStep` (card-writing path) and `runEvaluateInMemory` (tool path). The `path` parameter accepts a single realm-relative file; non-evaluable extensions and test files (`*.test.*`) short-circuit to `status: 'error'` without calling the realm.

Failure line/column numbers still reference the transpiled module — the tool description points the agent at `fetch_transpiled_module` for debugging while making explicit that transpiled output is read-only scratch and must never be copied into source.

### run_instantiate: In-Memory Self-Validation (CS-10823)

The `run_instantiate` tool lets the agent instantiate example card instances in the target realm via the prerenderer sandbox and get back a flat `RunInstantiateResult` (`status`, `instancesChecked`, `instancesWithErrors`, `durationMs`, `instanceFiles`, `failures: { path, cardName, error, stackTrace? }[]`). Unlike the pipeline's `InstantiateValidationStep`, it does NOT write an `InstantiateResult` card — so the agent can call it mid-turn as many times as it likes without creating realm artifacts. The orchestrator still runs the full validation pipeline (which writes the durable `InstantiateResult` card) after `signal_done`, so calling this tool is optional.

Discovery (every Spec card in the realm, every `linkedExample` on every card/app Spec — same spec-based discovery the validation step uses) and per-instance instantiation now live in the shared `src/instantiate-execution.ts` engine, used by both `InstantiateValidationStep` (card-writing path) and `runInstantiateInMemory` (tool path). Spec-discovered example paths are normalized to `.json`-suffixed realm-relative form (Boxel relationship `self` links are extensionless) so the tool's `instanceFiles` list has the same shape whether the tool was called with or without `path`. The `path` parameter accepts a single realm-relative `.json` file and skips spec discovery entirely — the example's `meta.adoptsFrom` supplies the module + card name. Non-`.json` paths short-circuit to `status: 'error'` without calling the realm.

Failure line/column numbers still reference the transpiled module — the tool description points the agent at `fetch_transpiled_module` for debugging while making explicit that transpiled output is read-only scratch and must never be copied into source.

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
- **CS-10520** — Factory as boxel-cli subcommands; migrate realm-operations; retire all thin-wrapper factory tools whose sole job is to proxy a single boxel-cli command or client method (see "Wrapper-Tool Retirement" below for the inclusive list and the wrapper-vs-compound distinction). Compound domain tools and factory-only control-flow tools stay.
- **CS-10642** — boxel-cli owns full auth lifecycle (realm server tokens, per-realm tokens, auto-acquisition)
- **CS-10613** — Skill alignment: deduplicate, establish consistent homes, create `boxel-api` skill
- **CS-10670** — boxel-cli publishes tool definitions for factory consumption (tool delegation)
- **CS-10666** — Create `boxel-api` skill (federated search, realm creation, auth model)
- **CS-10667** — Create `boxel-command` skill (host commands via prerenderer)
- **CS-10518** — `--agent claude | codex | openrouter[=<model>]` selection (landed). Default is `claude`. No env vars; no host-environment auto-detection.
- **CS-10593** — Claude Code native LLM support (`ClaudeCodeFactoryAgent`, built on `@anthropic-ai/claude-agent-sdk`). Tools register as in-process callbacks via `createSdkMcpServer` + `tool(name, desc, zodShape, execute)`; JSON-Schema → Zod conversion is confined to `factory-tool-schema-adapter.ts`. **Landed.**
- **CS-10594** — Codex CLI native support (stub only as of CS-10518; `--agent codex` currently throws "not yet implemented"). Future implementation uses `@openai/codex-sdk` + an in-process MCP stdio server bridging `FactoryTool[]`, `codex exec --json`, and an ephemeral `CODEX_HOME`. See the CS-10594 Linear comment for the full design.

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

1. **Profile-only auth, no environment variables** — phase 1 had a dual-auth path: the factory accepted either `MATRIX_URL`, `MATRIX_USERNAME`, `MATRIX_PASSWORD`, and `REALM_SERVER_URL` env vars **or** an active Boxel profile. That duality is removed. Phase 2 requires an active Boxel profile (`boxel profile add`) for every run — the factory does not read Matrix auth from environment variables. `--realm-server-url` also falls back to the active profile's `realmServerUrl` instead of defaulting to a hardcoded localhost URL, so staging and production Just Work without extra flags. Matrix login, OpenID exchange, server-session minting, and per-realm token acquisition all happen inside boxel-cli's `ProfileManager`, seeded from the profiles file (`~/.boxel-cli/profiles.json`) — never from the process environment. (Exception: the `BOXEL_PASSWORD` env var remains as a non-interactive input to `boxel profile add` itself; the factory runtime never reads it.)

2. **Two-tier token model** — boxel-cli understands both realm server tokens (obtained via Matrix OpenID → `POST /_server-session`, grants server-level access) and per-realm tokens (obtained via `POST /_realm-auth`, grants access to specific realms). Both are cached and refreshed automatically.

3. **Automatic token acquisition on realm creation** — When `boxel create-realm` creates a new realm, boxel-cli automatically waits for readiness, obtains the per-realm JWT, and stores it in its auth state. Subsequent `boxel pull`/`boxel sync` on that realm Just Work — tokens are managed internally by boxel-cli.

4. **Programmatic API with implicit auth** — Export a `BoxelCLIClient` that the factory imports. Callers do not pass credentials or tokens; the client reads the active profile on construction and handles auth for every request:

   ```typescript
   import { BoxelCLIClient } from '@cardstack/boxel-cli/api';
   const client = new BoxelCLIClient();
   await client.createRealm({ realmName, displayName }); // token auto-acquired
   await client.pull(realmUrl, workspaceDir); // uses stored token
   // (sync is a future addition; see CS-10520)
   ```

5. **Token refresh for long-running operations** — The factory loop runs for hours. boxel-cli's `RealmAuthClient` already has token refresh with 60s lead time — this extends to cover all realm operations so long-running sessions don't fail mid-stream.

After this, the factory deletes `realm-auth.ts`, auth portions of `boxel.ts`, and all `authorization`/`serverToken`/`realmTokens` fields threaded through its config types. It also stops reading `MATRIX_URL`/`MATRIX_USERNAME`/`MATRIX_PASSWORD`/`REALM_SERVER_URL` from the environment entirely.

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

`BOXEL_CLI_TOOLS` (`boxel-sync`, `boxel-push`, `boxel-pull`, `boxel-status`, `boxel-create`, `boxel-history`) become available to the agent. The factory-level wrapper tools are retired per the "Wrapper-Tool Retirement" rule below — they don't stay as convenience aliases.

#### Wrapper-Tool Retirement (the intended outcome of CS-10520)

The goal of CS-10520 is to eliminate every factory tool that exists solely to proxy a single boxel-cli operation. When the agent has (a) a synced local workspace for file I/O and (b) boxel-cli commands for everything that can't be a filesystem op, there is no remaining reason to maintain a parallel set of factory tools that wrap the same calls.

**Retired — thin 1:1 wrappers over a boxel-cli command or client method:**

| Factory tool                                  | Replacement                                                          |
| --------------------------------------------- | -------------------------------------------------------------------- |
| `read_file`                                   | Local filesystem read on the synced workspace                        |
| `write_file`                                  | Local filesystem write + `boxel sync`                                |
| `search_realm`                                | `boxel search` (federated) or `client.search` for index queries      |
| `run_command`                                 | `boxel run-command` (already a CLI)                                  |
| `fetch_transpiled_module`                     | `boxel read-transpiled` (CS-10806)                                   |
| `realm-read` / `realm-write` / `realm-delete` | Native file I/O on the workspace; CLI commands for non-target realms |

**Kept — compound tools with factory-owned domain logic on top of the CLI:**

- `update_issue`, `update_project`, `create_knowledge`, `create_catalog_spec`, `add_comment` — these do read-patch-write merging, schema enforcement, `adoptsFrom` wiring, and other Boxel-card-specific semantics. Not 1:1 with any CLI call. Long-term these may migrate into boxel-cli as higher-level card commands (e.g., `boxel card-merge`), but the compound logic has to move with them — they don't retire in this wave.

**Kept — factory-only control flow, no CLI equivalent exists:**

- `signal_done`, `request_clarification` — control signals back to the ralph loop; no realm I/O.
- `run_tests` — Playwright orchestration across realm server + host app + Synapse; factory-specific.

The test for whether a tool retires is: _would replacing it with a skill that says "use `boxel <cmd>` / native file I/O" leave behind any logic the factory uniquely owns?_ If no, retire. If yes, keep (or migrate that logic into boxel-cli first).

### Target-Realm I/O Migrates to Local Filesystem

**Status:** 🟡 in review — CS-10882 (PR #4492). The notes below describe the design as planned; the implementation in the open PR matched the plan with a few divergences captured in [_Implementation notes_](#implementation-notes-cs-10882) at the end of this section. This section will flip to "✅ landed" once the PR merges.

CS-10642 landed the auth-lifecycle migration: the factory no longer manages JWTs and calls the realm through `BoxelCLIClient` instead of raw fetch. It did **not** change _where_ target-realm reads and writes go — they still round-trip over HTTP via `client.read` / `client.write` / `client.delete`. That is the next step.

**Principle:** the target realm is a synced local workspace. Any code that currently does `client.read(targetRealmUrl, …)` or `client.write(targetRealmUrl, …)` against the _target realm_ is replaced by local filesystem operations. Push/pull synchronization (`client.pull`, `client.sync`) is the only path data takes between the local workspace and the target realm.

Operations that do **not** change:

- **Structured search** (`client.search`) is a realm-index query, not a file op. The issue scheduler and instantiate step still need it — an alternative local index would be out of scope. For the target realm, search reads stay as `client.search`.
- **Server-scoped operations** (`client.runCommand`, `client.lint`, `client.waitForReady`, `client.waitForFile`, `client.atomicOperation`, `client.cancelAllIndexingJobs`) target the realm server or host commands, not target-realm files. They stay.
- **Source realm / factory realm I/O** (brief loading, darkfactory schema fetches via `_run-command`) is not the target realm. It stays as `client.*`.

**Workspace lifecycle:**

1. At factory start (after `bootstrapFactoryTargetRealm`), pull the target realm into a workspace directory: `await client.pull(targetRealmUrl, workspaceDir, { delete: true })`. This gives the agent a mirror of the realm on disk.
2. The agent and all factory modules read/write files under `workspaceDir` using `fs` / `fs.promises` — no `client.read` / `client.write` for target-realm paths.
3. After each inner-loop iteration (agent turn) and at the end of each outer-loop cycle, push: `await client.sync(workspaceDir, { preferLocal: true })`. This uploads agent-authored files and validation artifacts in one batch, and propagates deletions in both directions.
4. On factory exit, optionally leave the workspace in place so humans can inspect it, or clean it up per the workspace lifecycle policy (see open question below).

**Call sites to convert (target realm only):**

| File                                                                                                    | Current call                                                           | After                                                                                                            |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `factory-tool-builder.ts` — `write_file`                                                                | `client.write(targetRealmUrl, path, content)`                          | `fs.writeFile(join(workspaceDir, path), content)`                                                                |
| `factory-tool-builder.ts` — `read_file`                                                                 | `client.read(targetRealmUrl, path)`                                    | `fs.readFile(join(workspaceDir, path))`                                                                          |
| `factory-tool-builder.ts` — `update_project`, `update_issue`, `create_knowledge`, `create_catalog_spec` | read-patch-write via `client.read` + `client.write`                    | same pattern but on local files                                                                                  |
| `factory-tool-builder.ts` — `add_comment`                                                               | `addCommentToIssue(client, …)` → `client.read` + `client.write`        | `addCommentToIssue(workspaceDir, …)` that operates on local files                                                |
| `factory-tool-executor.ts` — `realm-read` / `realm-write` / `realm-delete` tools                        | `client.read` / `client.write` / `client.delete`                       | local fs or retire the tool (LLM uses native file I/O)                                                           |
| `factory-seed.ts` — `createSeedIssue`                                                                   | `client.read` + `client.write` + `client.waitForFile`                  | `fs.access` + `fs.writeFile`; post-sync `waitForFile` is unnecessary because the file exists locally immediately |
| `issue-scheduler.ts` — `updateIssue`, `updateProjectStatus`, `addComment`                               | `client.read` + `client.write`                                         | local file read-patch-write; sync pushes updated status back to the realm                                        |
| `issue-scheduler.ts` — `listIssues`, `refreshIssue` (search queries)                                    | `client.search`                                                        | **unchanged** (index query, see principle above)                                                                 |
| `realm-issue-relationship-loader.ts` — `loadProject`, `loadKnowledge`                                   | `client.read`                                                          | `fs.readFile` from workspace                                                                                     |
| `realm-operations.ts` — `addCommentToIssue`, `getNextValidationSequenceNumber`                          | `client.read` + `client.write`; `client.search`                        | comments move to local fs; sequence-number search stays                                                          |
| `test-run-cards.ts`, `lint-result-cards.ts`, `eval-result-cards.ts`, `instantiate-result-cards.ts`      | `client.read` + `client.write` for TestRun/Lint/Eval/Instantiate cards | write/read validation artifacts locally; the next sync push propagates them to the realm                         |
| `validators/test-step.ts` — reads TestRun card back                                                     | `client.read`                                                          | local `fs.readFile` from workspace                                                                               |
| `validators/lint-step.ts` — reads source file content                                                   | `client.read`                                                          | local `fs.readFile`                                                                                              |
| `validators/instantiate-step.ts` — reads Spec example cards                                             | `client.read`                                                          | local `fs.readFile`                                                                                              |

**Sync interleaving with validation:**

The validation pipeline runs after each agent turn. The sync has to interleave carefully with validation because some checks (the prerenderer-backed `eval` and `instantiate` steps) need the realm to reflect the agent's latest writes before they run:

1. Agent turn ends.
2. `client.sync(workspaceDir, { preferLocal: true })` — push the agent's local writes to the realm so the prerenderer sees them.
3. Validation pipeline runs. Test artifact cards (TestRun, LintResult, EvalResult, InstantiateResult) are written locally as validation proceeds.
4. Second `client.sync(workspaceDir, { preferLocal: true })` — push the artifact cards back to the realm so humans/agents can browse them in the Boxel UI.

Steps 2 and 4 can collapse to a single sync if validation artifacts are written before the prerenderer runs, but the two-phase version keeps the contract explicit: the realm is always consistent at validation boundaries.

**What this means for `realm-operations.ts`:**

After target-realm I/O moves to the filesystem, `realm-operations.ts` shrinks further:

- `addCommentToIssue(client, …)` → becomes `addCommentToIssue(workspaceDir, …)` operating on local files
- `getNextValidationSequenceNumber(client, …)` → stays (it's a search query)
- `ensureJsonExtension` → unchanged
- `pullRealmFiles` → deleted; callers use `client.pull` directly

**Out of scope for this migration:**

- Replacing `client.search` with a local FS index walk. The realm's indexed search (filter by type, sort by sequenceNumber, etc.) has no equivalent in pure file operations. A local query engine is future work.
- Replacing `client.runCommand` / `client.lint`. These are server-side host command invocations, not file I/O.

#### Implementation notes (CS-10882)

A few practical points where the shipped work diverged from the plan above:

- **Workspace primitives, not raw `fs`.** Call sites now use `readCard` / `writeCard` / `deleteCard` / `readCardById` / `workspaceFileExists` / `ensureWorkspaceDir` / `resetWorkspaceDir` / `resolveWorkspaceDir` from a new `src/workspace-fs.ts` module instead of calling `fs.promises` directly. The result shapes mirror `BoxelCLIClient` (`{ ok, status, document?, content?, error? }`) so call sites swap cleanly. Every primitive routes its `path` argument through a shared safety guard that rejects absolute paths, `..` traversal, percent-encoded escapes, and any value that resolves outside the workspace dir — defense in depth, so an agent-supplied path can't escape even if a calling tool forgets to validate.
- **`realm-read` / `realm-write` / `realm-delete` are scoped, not retired.** Step 4's plan was to retire these tools. CS-10882 instead leaves them registered and adds a target-realm rejection in the executor: an agent that hands them a `realm-url` matching the factory's target realm gets a `ToolSafetyError`, but the same tools remain usable for non-target realms (scratch realms, external catalogs, etc.). Full retirement is deferred to a follow-up.
- **`SyncResult` returns structured outcome, not void.** `syncWorkspace()` callbacks now return `{ ok, error? }`. The loop refuses to mark an issue done when the post-agent or post-validator sync failed — vacuously-passing validators (no files reached the realm to validate) no longer flip an issue to `done`. The sync error is also injected into the next iteration's context so the agent can react.
- **Initial post-seed sync throws on per-file errors.** Plan said "warning"; in practice a silent warn left the loop running with zero issues and exiting clean (`outcome=all_issues_done`). The entrypoint-level sync now throws.
- **Workspace auto-resets on freshly-created realms.** The deterministic `os.tmpdir()/boxel-factory-workspaces/<slug>` cache breaks when a realm is recreated between runs (local has stale state, remote has only `index.json`). The entrypoint detects `targetRealm.createdRealm` and wipes the workspace before pulling. Slug now preserves protocol so `http://host/realm/` and `https://host/realm/` map to distinct dirs.
- **stdout redirect, applied broadly.** `client.pull` / `client.sync` write progress via both `console.log` and `process.stdout.write` (`\r` tickers). A new `redirect-stdout.ts` patches both for the duration of any sync call so progress lands on stderr — the factory's `--debug` JSON summary on stdout stays clean.
- **Cross-package fix to the realm server's `_atomic` handler.** While end-to-end testing CS-10882 we discovered that an atomic batch containing both a module (`foo.gts`) and an instance that adopts from it (`FooCard/instance.json`) returned `500 FilterRefersToNonexistentTypeError`. Cause: `_batchWrite` iterated files in arrival order and called `fileSerialization` on each instance _before_ flushing the module→index. Two-line fix: sort modules ahead of instances inside the loop, and run the index flush before serialization. Plus a regression test in `packages/realm-server/tests/atomic-endpoints-test.ts`. Also added the missing `console.error` in the atomic catch so future failures aren't silent.
- **Cross-package fix to boxel-cli's sync planner.** Realm `_mtimes` returns paths URL-encoded (`Knowledge%20Articles/foo.json`); local listings use the decoded form. The diff treated the two as different files and a second sync would "Pull: 1" the remote copy, leaving the workspace with a duplicate. Symmetric bug in the atomic-upload response handler keyed `hrefToRelative` by the unencoded href but the realm echoes back the encoded id. Both fixed via `decodeURIComponent` at the boundary, with a regression test in `client-sync.test.ts`.

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

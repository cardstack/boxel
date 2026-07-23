# Software Factory

The software factory is an automated card-development system that takes a brief (a description of what card to build) and produces a working Boxel card — complete with card definition, sample instances, catalog spec, and QUnit tests — in a target realm.

## How It Works

The factory uses an **issue-driven agentic loop** where the LLM agent processes issues one at a time, with automated validation after every turn:

1. **Intake** — Fetch a brief card from a source realm, normalize it into a structured representation
2. **Seed Issue** — Create a single bootstrap issue in the target realm (`Issues/bootstrap-seed`)
3. **Bootstrap (via agent)** — The agent picks up the seed issue, reads the brief, and creates: a Project card, Knowledge Articles, and two implementation Issues
4. **Implementation (via agent)** — The agent works through each implementation issue in priority/dependency order:
   - Issue #1: Create card definition (`.gts`) and co-located QUnit tests (`.test.gts`)
   - Issue #2: Create catalog spec (`Spec/`) with linked example instances
5. **Validation (after every agent turn)** — The orchestrator runs a 5-step validation pipeline: parse, lint, evaluate, instantiate, and run tests. Failures are fed back to the agent for self-correction.

The orchestrator (`runIssueLoop`) is a thin scheduler that picks the next unblocked issue, hands it to the agent, runs validation, and reads the updated issue state. All domain decisions (what to implement, when to create sub-issues, when to mark as blocked) live in the agent's prompt and skills.

### Realm Roles

- **Source realm** (`packages/software-factory/realm/`) — publishes shared modules, card type definitions (Project, Issue, KnowledgeArticle, TestRun), briefs, and templates. Never written to by the factory.
- **Target realm** (user-specified) — receives all generated artifacts: card definitions, instances, specs, test files, and TestRun results.
- **Fixture realm** (`test-fixtures/`) — disposable test input for development-time verification of the factory itself.

### Target Realm Artifact Structure

| Path                  | What it is                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `index.json`          | `RealmDashboard` dashboard the realm opens to — Overview / Board / Artifacts tabs (only for realms the factory created) |
| `cards-grid.json`     | `CardsGrid` instance the Artifacts tab renders                                                                          |
| `Projects/`           | Project card with objective, scope, success criteria                                                                    |
| `Issues/`             | Issue cards — bootstrap seed + implementation issues                                                                    |
| `Knowledge Articles/` | Context articles derived from the brief                                                                                 |
| `*.gts`               | Card definition files                                                                                                   |
| `*.test.gts`          | Co-located QUnit test files                                                                                             |
| `CardName/`           | Sample card instances with realistic data                                                                               |
| `Spec/`               | Catalog Spec cards linking to card definitions and sample instances                                                     |
| `Validations/`        | Validation artifacts — TestRun cards (test results) and lint results                                                    |

## Prerequisites

- Node >= 24 (the repo pins `24.17.0` via `.nvmrc` / Volta — run `nvm use` or let Volta pick it up)
- **One-time build/setup** — on a fresh `pnpm install`-only checkout, run:

  ```bash
  cd packages/software-factory
  pnpm factory:setup
  ```

  This is idempotent (skips anything already built) and provisions the three
  artifacts the factory needs that aren't committed: the boxel-cli API bundle
  (`boxel-cli/dist/api.js`), a dev-mode host build with test entries
  (`host/dist/tests/index.html`), and the Playwright Chromium headless-shell
  binary. `pnpm factory:go` also detects any missing prerequisite up front and
  points you back here. Pass `--force` to rebuild everything.

- Docker running
- `mise run dev-all` (starts realm server, host app, icons server, Postgres, Synapse)
- Active Boxel CLI profile (`boxel profile add`)
- LLM backend credentials, matching your chosen `--agent` (see [Choosing an LLM backend](#choosing-an-llm-backend---agent) below):
  - **Default (`--agent claude`)**: `claude` CLI installed and authenticated (run `claude login` once), or `ANTHROPIC_API_KEY` set in the environment. The factory uses the Claude Agent SDK, which picks up whichever is available.
  - **`--agent openrouter`**: `OPENROUTER_API_KEY` in the environment.
  - **`--agent codex`**: not yet implemented (tracked in CS-10594).

## Running the Factory

Make sure the prerequisites above are met, and that you have a brief card published in the software-factory realm (e.g., `https://localhost:4201/software-factory/Wiki/sticky-note`).

Set up your profile:

```bash
boxel profile add     # Interactive wizard — choose your environment, enter credentials
```

Then run the factory (default backend is Claude via the Agent SDK):

```bash
cd packages/software-factory

pnpm factory:go \
  --brief-url https://localhost:4201/software-factory/Wiki/sticky-note \
  --target-realm https://localhost:4201/your-username/my-test-realm/ \
  --debug
```

The `--debug` flag shows LLM prompts, tool calls and their results, and `console.log` output from QUnit tests as they run.

The factory is a plain Node.js CLI. "Running it from inside Claude Code" just means Claude Code's Bash tool runs the same `pnpm factory:go …` command on your behalf — there's no separate mode, no custom skill required. You can always run it directly from your shell instead.

### Choosing an LLM backend (`--agent`)

One CLI flag picks the LLM backend. Omit it to get the default.

| Flag                            | Backend                                       | When to use                                            |
| ------------------------------- | --------------------------------------------- | ------------------------------------------------------ |
| _(omitted)_                     | `claude` (default)                            | Anywhere Claude Code can run.                          |
| `--agent claude`                | Claude Code Agent SDK                         | Same as default; use to be explicit.                   |
| `--agent openrouter`            | OpenRouter, model `anthropic/claude-opus-4-7` | You want the OpenRouter path.                          |
| `--agent openrouter=<model-id>` | OpenRouter, specific model                    | E.g., `--agent openrouter=anthropic/claude-sonnet-4`.  |
| `--agent codex`                 | Codex CLI (not yet implemented)               | Reserved; currently errors with a pointer to CS-10594. |

### Retrying blocked issues

By default, the factory resets blocked issues to `backlog` with `critical` priority so the scheduler picks them up first. Only issues blocked by validation failures (not by dependency on another issue) are reset. Prior validation failure details are preserved in issue comments so the agent has context for the retry.

To skip retrying blocked issues, use `--no-retry-blocked`:

```bash
pnpm factory:go \
  --brief-url https://localhost:4201/software-factory/Wiki/sticky-note \
  --target-realm https://localhost:4201/your-username/my-test-realm/ \
  --no-retry-blocked
```

### What to expect on the command line

```
[factory:go] brief=https://localhost:4201/software-factory/Wiki/sticky-note
[factory:go] Starting seed issue + issue-driven loop...
[factory-seed] Creating seed issue at Issues/bootstrap-seed.json
[issue-loop] Starting issue loop: targetRealm=..., maxIterationsPerIssue=5
[issue-loop] Outer cycle 1: picked issue "Issues/bootstrap-seed" (status=backlog, priority=critical)
[issue-loop]   Inner iteration 1/5 for issue "Issues/bootstrap-seed"
  ... agent creates Project, Knowledge Articles, 2 implementation Issues ...
[issue-loop] Outer cycle 2: picked issue "Issues/<slug>-define-card" (status=backlog, priority=high)
  ... agent writes card definition + tests, validation pipeline runs ...
[issue-loop] Outer cycle 3: picked issue "Issues/<slug>-catalog-spec" (status=backlog, priority=medium)
  ... agent writes catalog spec + examples ...
[issue-loop] Outer loop finished: outcome=all_issues_done, cycles=3
[factory:go] Issue loop complete: outcome=all_issues_done outerCycles=3 issues=3
```

### What to expect in the Boxel host app (target realm)

A realm the factory created opens to the **Overview dashboard** (`index.json`, a
`RealmDashboard` card) rather than a bare card grid. It has three tabs:
Overview (project status, setup roadmap, issue KPIs, validation runs), Board
(the kanban IssueTracker), and Artifacts (the CardsGrid of everything created).

| Folder / File                | What it is                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `index.json`                 | The Overview dashboard the realm opens to (Overview / Board / Artifacts tabs) |
| `Projects/`                  | A Project card with the brief's objective and success criteria                |
| `Issues/bootstrap-seed`      | Bootstrap issue — status `done`, issueType `bootstrap`                        |
| `Issues/<slug>-define-card`  | Implementation issue #1 — card definition + tests                             |
| `Issues/<slug>-catalog-spec` | Implementation issue #2 — catalog spec + examples                             |
| `Knowledge Articles/`        | Brief context and agent onboarding articles                                   |
| `*.gts`                      | Card definition file(s) for the implemented card                              |
| `*.test.gts`                 | Co-located QUnit test file(s)                                                 |
| `CardName/`                  | Sample card instance(s) with realistic data                                   |
| `Spec/`                      | Catalog Spec card(s) linking to the card definition and sample instances      |
| `Validations/`               | Validation artifacts — TestRun cards and lint results (pass/fail)             |

## Architecture

```
factory:go → createSeedIssue() → runIssueLoop()
                                    ├── IssueScheduler (picks next unblocked issue)
                                    ├── ContextBuilder.buildForIssue() (loads project/knowledge from issue relationships)
                                    ├── ToolUseFactoryAgent.run() (LLM calls tools)
                                    └── ValidationPipeline.validate() (parse, lint, evaluate, instantiate, test)
```

Key modules:

- `src/factory-entrypoint.ts` — CLI entrypoint, creates seed issue + runs issue loop
- `src/factory-seed.ts` — creates the bootstrap seed issue in the realm; links its `project` once the bootstrap issue creates one
- `src/factory-realm-index.ts` — writes the `RealmDashboard` dashboard for a freshly-created realm and links its `board` to the bootstrap IssueTracker
- `src/factory-issue-loop-wiring.ts` — constructs all loop infrastructure (auth, tools, agent, validator)
- `src/issue-loop.ts` — the two-level issue-driven loop (outer: issues, inner: iterations with validation)
- `src/issue-scheduler.ts` — issue selection with priority/dependency ordering
- `src/factory-agent-tool-use.ts` — LLM agent using native tool-use protocol
- `src/factory-context-builder.ts` — assembles agent context from issue relationships
- `src/validators/validation-pipeline.ts` — 5-step validation after every agent turn

## Layout

- `test-fixtures/darkfactory-adopter/`
  - Disposable adopter fixture realm used by the Playwright tests
- `src/harness.ts`
  - Cached template DB creation and isolated realm server startup
- `tests/`
  - Package test home for top-level `*.test.ts` and `*.spec.ts`
- `tests/helpers/`
  - Shared test helpers only, not standalone test files

## Notes

- **Realm card tests (`realm/*.test.gts`)** — QUnit tests co-located with source realm card definitions. These run inside the Boxel host app (via the host test suite), not via Playwright. To run them, use `pnpm test` in `packages/host` with the relevant test file pattern. They are separate from the Playwright specs in `tests/` which test the factory loop end-to-end. To run them interactively in the browser, go to: `https://localhost:4200/tests/index.html?liveTest=true&realmURL=https%3A%2F%2Flocalhost%3A4201%2Fsoftware-factory%2F`
- Template DBs are reused across runs while the seeded Postgres container stays up.
- `serve:support` publishes a shared support context in `/tmp/software-factory-runtime/support.json`.
- When that shared support context exists, `serve:realm` and `smoke:realm` reuse the running Synapse and prerender services instead of restarting them.
- Playwright specs can choose their realm-server isolation mode with
  `test.use({ realmServerMode: 'shared' | 'isolated' })` from
  `tests/fixtures.ts`.
- `shared` is the default and reuses one realm server per spec file and worker
  when tests are read-only.
- `isolated` starts a fresh realm server per test for mutable scenarios.
- Playwright keeps the support services alive for the whole run; realm server
  lifetime is controlled per spec via `realmServerMode`.
- The browser tests seed a deterministic local Matrix user
  (`software-factory-browser`) so they do not depend on a human-managed profile.
- Host requests for the base realm URL are redirected to the isolated realm
  server. Skills redirects are only enabled when
  `TEST_HARNESS_INCLUDE_SKILLS=1`.
- The test fixtures should point at the isolated `4205` software-factory source
  realm directly, so they do not depend on any ambient external realm server.

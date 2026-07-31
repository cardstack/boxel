# Software Factory

The software factory is an automated card-development system that takes a brief (a description of what to build) and produces a working Boxel card family in a target realm — design language first, then card definitions, catalog specs, and sample instances, with an optional QUnit hardening pass.

## How It Works

The factory runs an **issue-driven agentic loop**: the agent processes issues one at a time, design before code, with automated validation after every turn and a render-gated review before anything counts as done.

1. **Intake** — fetch a brief card from a source realm (or synthesize one from a GitHub repo with `--repo-url`), normalize it into a structured representation.
2. **Seeds** — write the bootstrap issue (`Issues/bootstrap-seed`) and a design-foundation issue (`Issues/design-foundation-seed`) that blocks all implementation work.
3. **Bootstrap** — the agent reads the brief and creates the tracker: a Project card, Knowledge Articles, an IssueTracker board, and one implementation issue per entry-point card.
4. **Design foundation** — one turn establishes the shared design language: a brand-guide Knowledge Article, `design/tokens.css`, and a family coherence sheet, screenshot-critiqued before any card is designed in detail.
5. **Implementation** — each issue runs as a **design turn** (self-contained HTML mockup with realistic copy → screenshot → critique → revise, on the flagship model) followed by a **build turn** (translate the accepted mockup into `.gts` + Spec + examples, on the cheap model, forked from the design session).
6. **Validation** — after every agent turn the orchestrator runs the pipeline: parse, lint, evaluate, instantiate, plus a host-tools import gate. Failures feed back into cheap fix iterations. (No per-issue tests — testing is the hardening phase's job.)
7. **Render gate + review** — the finished issue's cards are screenshotted via the realm's prerenderer; a reviewer turn judges the renders against the acceptance criteria and either approves or bounces the issue back once with comments.
8. **Later phases** — depending on `--to-phase`: a hardening pass (QUnit tests per shipped card) and/or the bootstrap's pass-2 polishing scope. Anything beyond the target phase stays on the board for an operator.

The orchestrator (`runIssueLoop`) is a thin scheduler: it picks the next unblocked issue, hands it to the agent, runs validation, and reads back the updated issue state. Domain decisions live in the agent's prompt and skills.

### Lifecycle phases (`--to-phase`)

The run works phases front to back and stops after the target phase (inclusive). Later-phase issues stay on the board as a visible decision point instead of executing unattended.

| Phase                        | What runs                                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `design`                     | Bootstrap + the design-foundation issue only — a design-review checkpoint.                                            |
| `implementation` _(default)_ | Everything through built, reviewed cards.                                                                             |
| `hardening`                  | Also synthesizes one QUnit test-pass issue per shipped card; the test suite is its gate (no PM review).               |
| `polishing`                  | Also executes the bootstrap's self-generated "pass 2" enhancement scope, which otherwise waits for operator approval. |

### Realm Roles

- **Source realm** (`packages/software-factory/realm/`) — publishes shared modules, card type definitions (Project, Issue, KnowledgeArticle, TestRun), briefs, and templates. Never written to by the factory.
- **Target (product) realm** (user-specified) — receives the deliverable: card definitions, instances, specs. Keeps its stock index; it's the user's realm, not a factory surface.
- **Control realm** (`--control-realm`, recommended) — receives the machinery: issues, tracker cards, validation artifacts, and the live run log. Splitting control from product means tracker churn never invalidates product queries and vice versa. Omit it and everything lands in the target realm.
- **Fixture realm** (`test-fixtures/`) — disposable test input for development-time verification of the factory itself.

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
  - **`--agent codex`**: not yet implemented.

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
  --target-realm https://localhost:4201/your-username/my-app/ \
  --control-realm https://localhost:4201/your-username/my-app-control/ \
  --debug
```

Both realms are created if missing. The `--debug` flag shows LLM prompts, tool calls and their results, and per-phase timing. Add `--to-phase hardening` to get a tested card family, or `--to-phase design` to stop at the design-language checkpoint.

Re-running the same command against the same realms **resumes**: finished issues stay finished, and the loop picks up whatever the board says is next.

The factory is a plain Node.js CLI. "Running it from inside Claude Code" just means Claude Code's Bash tool runs the same `pnpm factory:go …` command on your behalf — there's no separate mode, no custom skill required. You can always run it directly from your shell instead.

### Choosing an LLM backend (`--agent`)

One CLI flag picks the LLM backend. Omit it to get the default.

| Flag                            | Backend                                       | When to use                                           |
| ------------------------------- | --------------------------------------------- | ----------------------------------------------------- |
| _(omitted)_                     | `claude` (default)                            | Anywhere Claude Code can run.                         |
| `--agent claude`                | Claude Code Agent SDK                         | Same as default; use to be explicit.                  |
| `--agent openrouter`            | OpenRouter, model `anthropic/claude-opus-4-7` | You want the OpenRouter path.                         |
| `--agent openrouter=<model-id>` | OpenRouter, specific model                    | E.g., `--agent openrouter=anthropic/claude-sonnet-4`. |
| `--agent codex`                 | Codex CLI (not yet implemented)               | Reserved; currently errors.                           |

### Model budgets per turn type

Taste turns run on the strong model; mechanical turns default to the cheap tier (claude backend only — other backends inherit their session model unless a flag says otherwise). Each `--*-model` flag takes a model id or `inherit`; each `--*-effort` takes `low|medium|high|xhigh|max`.

| Turn                                | Default                    | Override                                  |
| ----------------------------------- | -------------------------- | ----------------------------------------- |
| Design foundation, per-issue design | session flagship           | _(none — deliberately unbudgeted)_        |
| Bootstrap                           | `claude-sonnet-5` @ medium | `--bootstrap-model`, `--bootstrap-effort` |
| Build                               | `claude-sonnet-5` @ medium | `--build-model`, `--build-effort`         |
| Fix iterations                      | inherit @ medium           | `--fix-model`, `--fix-effort`             |
| Review (PM gate)                    | session flagship           | `--review-model`, `--review-effort`       |
| Hardening                           | `claude-sonnet-5` @ medium | _(none yet)_                              |

Other useful flags: `--no-phase-split` (single combined turn per issue), `--no-render-gate` (skip screenshot capture + review, e.g. without a prerenderer), `--no-retry-blocked` (leave validation-blocked issues alone instead of resetting them to backlog), `--monitor-level quiet|normal|verbose` (run-log narration volume). `pnpm factory:go --help` is the authoritative list.

### What to expect on the command line

```
[factory-entrypoint] brief=https://localhost:4201/software-factory/Wiki/sticky-note
[factory-entrypoint] Starting seed issue + issue-driven loop...
[issue-loop] Outer cycle 1: picked issue "Issues/bootstrap-seed" (status=backlog, priority=critical)
  ... bootstrap creates Project, board, Knowledge Articles, implementation issue(s) ...
[issue-loop] Outer cycle 2: picked issue "Issues/design-foundation-seed" ...
  ... brand guide, design/tokens.css, family sheet — screenshot, critique, revise ...
[issue-loop] Outer cycle 3: picked issue "Issues/sticky-note" ...
[issue-loop]   Phase-split: DESIGN turn starting (budget inherit flagship session)
[issue-loop]   Phase-split: BUILD turn starting (budget claude-sonnet-5/medium)
  ... validation pipeline, render gate captures, review turn ...
[issue-loop] Hardening phase: synthesized 1 issue(s): Issues/harden-sticky-note   (--to-phase hardening)
[issue-loop] Outer cycle 4: leaving polishing issue on the board: "Sticky Note — pass 2" — pass --to-phase polishing to execute it unattended
[issue-loop] Outer loop finished: outcome=all_issues_done
```

A live run log (`Runs/<slug>` in the control realm) narrates the same run inside Boxel — design screenshots, validation results, and scheduler notes as they happen.

### What lands where

Control realm (with the split):

| Path                      | What it is                                                       |
| ------------------------- | ---------------------------------------------------------------- |
| `Projects/`               | Project card with objective, scope, success criteria             |
| `Issues/`                 | Seeds, implementation issues, defects, hardening + polish issues |
| `Boards/`                 | The kanban IssueTracker                                          |
| `Knowledge Articles/`     | Brief context, agent onboarding, brand guide                     |
| `Runs/`, `RunLogEntries/` | The live-blog run log                                            |
| `Validations/`            | Validation artifacts — lint/parse/test result cards              |

Target (product) realm:

| Path         | What it is                                                     |
| ------------ | -------------------------------------------------------------- |
| `*.gts`      | Card definition files                                          |
| `CardName/`  | Sample card instances with realistic data                      |
| `Spec/`      | Catalog Spec cards linking definitions and samples             |
| `design/`    | tokens.css, mockups, and render captures from the design turns |
| `*.test.gts` | QUnit test files (hardening phase only)                        |

## Architecture

```
factory:go → createSeedIssue() → runIssueLoop()
                                    ├── IssueScheduler (picks next unblocked issue, phase-gated by --to-phase)
                                    ├── ContextBuilder.buildForIssue() (loads project/knowledge from issue relationships)
                                    ├── ClaudeCodeFactoryAgent.run() (design turn → build turn, forked session)
                                    ├── ValidationPipeline.validate() (parse, lint, evaluate, instantiate, imports; + tests for hardening issues)
                                    └── RenderGate + review turn (screenshots → verdict → done or rework)
```

Key modules:

- `src/factory-entrypoint.ts` — CLI entrypoint, creates seed issues + runs issue loop
- `src/factory-seed.ts` — writes the bootstrap/design-foundation/hardening issues; links seeds to the Project
- `src/factory-phase.ts` — the lifecycle phase model behind `--to-phase`
- `src/factory-issue-loop-wiring.ts` — constructs all loop infrastructure (auth, tools, agent, validator, run log, monitor)
- `src/issue-loop.ts` — the two-level issue-driven loop (outer: issues, inner: iterations with validation)
- `src/issue-scheduler.ts` — issue selection with priority/dependency ordering
- `src/factory-agent/claude-code.ts` — the Claude Agent SDK backend (`opencode.ts` for OpenRouter)
- `src/factory-context-builder.ts` — assembles agent context from issue relationships
- `src/validators/validation-pipeline.ts` — the validation pipeline run after every agent turn
- `src/run-trace.ts` — per-run NDJSON span telemetry (see `docs/run-trace.md`)

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

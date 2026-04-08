# Software Factory

The software factory is an automated card-development system that takes a brief (a description of what card to build) and produces a working Boxel card — complete with card definition, sample instances, catalog spec, and QUnit tests — in a target realm.

## How It Works

The factory flow has four phases:

1. **Intake** — Fetch a brief card from a source realm, normalize it into a structured representation
2. **Bootstrap** — Create a target realm (if needed), populate it with a Project card, Knowledge Articles, and starter Tickets
3. **Implementation** — An LLM agent picks up the active ticket and uses tool calls to write card definitions (`.gts`), sample instances (`.json`), catalog specs (`Spec/`), and QUnit test files (`.test.gts`) into the target realm
4. **Verification** — The orchestrator runs QUnit tests via Playwright in a real browser, collects structured results into a TestRun card, and feeds failures back to the agent for iteration

The agent iterates (implement → test → fix) until tests pass or max iterations are reached. The orchestrator (the "ralph loop") controls iteration count, test execution, and ticket selection deterministically — the LLM handles only the implementation work.

### Realm Roles

- **Source realm** (`packages/software-factory/realm/`) — publishes shared modules, card type definitions (Project, Ticket, KnowledgeArticle, TestRun), briefs, and templates. Never written to by the factory.
- **Target realm** (user-specified) — receives all generated artifacts: card definitions, instances, specs, test files, and TestRun results.
- **Fixture realm** (`test-fixtures/`) — disposable test input for development-time verification of the factory itself.

### Target Realm Artifact Structure

| Path                  | What it is                                                          |
| --------------------- | ------------------------------------------------------------------- |
| `Projects/`           | Project card with objective, scope, success criteria                |
| `Tickets/`            | Ticket cards tracking implementation work                           |
| `Knowledge Articles/` | Context articles derived from the brief                             |
| `*.gts`               | Card definition files                                               |
| `*.test.gts`          | Co-located QUnit test files                                         |
| `CardName/`           | Sample card instances with realistic data                           |
| `Spec/`               | Catalog Spec cards linking to card definitions and sample instances |
| `Test Runs/`          | TestRun cards with structured pass/fail results                     |

## Prerequisites

- Docker running
- `mise run dev-all` (starts realm server, host app, icons server, Postgres, Synapse)
- Matrix credentials (username/password) for realm creation and auth
- An [OpenRouter API key](https://openrouter.ai/keys) for the LLM agent (when running the full factory)

## Running the Factory

Make sure the prerequisites above are met, and that you have a brief card published in the software-factory realm (e.g., `http://localhost:4201/software-factory/Wiki/sticky-note`).

Set up credentials first (these persist in your shell session):

```bash
export MATRIX_URL=http://localhost:8008/
export MATRIX_USERNAME=your-username
read -s 'MATRIX_PASSWORD?Matrix password: ' && export MATRIX_PASSWORD
export OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

Then run the factory:

```bash
cd packages/software-factory

pnpm factory:go -- \
  --brief-url http://localhost:4201/software-factory/Wiki/sticky-note \
  --target-realm-url http://localhost:4201/your-username/my-test-realm/ \
  --debug
```

The `--debug` flag shows LLM prompts, tool calls and their results, and `console.log` output from QUnit tests as they run.

### What to expect on the command line

```
[factory:go] mode=implement brief=http://localhost:4201/software-factory/Wiki/sticky-note
[factory:go] Starting bootstrap + implement flow...
[test-run-execution] Serving QUnit page at http://127.0.0.1:<port> for realm ...
[test-run-execution] QUnit completed in <N>ms: <N> test(s)
[factory-implement] Updated ticket status to done
[factory:go] Implement complete: outcome=tests_passed iterations=<N> toolCalls=<N>
```

### What to expect in the Boxel host app (target realm)

| Folder / File              | What it is                                                                |
| -------------------------- | ------------------------------------------------------------------------- |
| `Projects/`                | A Project card with the brief's objective and success criteria            |
| `Tickets/`                 | Ticket cards — the active ticket should show status `done`                |
| `Knowledge Articles/`      | Context articles derived from the brief                                   |
| `*.gts`                    | Card definition file(s) for the implemented card                          |
| `*.test.gts`               | Co-located QUnit test file(s)                                             |
| `StickyNote/` (or similar) | Sample card instance(s) with realistic data                               |
| `Spec/`                    | Catalog Spec card(s) linking to the card definition and sample instances  |
| `Test Runs/`               | TestRun card(s) with structured pass/fail results grouped by QUnit module |

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
  `SOFTWARE_FACTORY_INCLUDE_SKILLS=1`.
- The test fixtures should point at the isolated `4205` software-factory source
  realm directly, so they do not depend on any ambient external realm server.

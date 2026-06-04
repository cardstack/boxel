# Instructions for AI Agents

## Type checking

- Use `glint` (not `glint --declaration`) for type checking. The `--declaration` flag emits hundreds of `.d.ts` files that pollute the working tree.
- Never use `tsc` directly — this project uses glint for type checking.

## Tooling prerequisites

- We pin the toolchain with [mise](https://mise.jdx.dev/) (`.mise.toml`), which manages Node.js and pnpm versions. Run `mise install` from the repo root to get the correct versions—avoid global installs outside mise.
- pnpm is required for all scripts; use the pinned version as specified above.
- Docker is required (Postgres, Synapse, SMTP, Stripe CLI container). Ensure the daemon is running and you can run `docker` without sudo.

## GitHub Actions failure triage helper

- Use `pnpm ci:failures -- ...` to quickly summarize failed jobs and extract actionable test failures from GitHub Actions logs.
- This command requires GitHub CLI (`gh`) to be installed and authenticated.
- Common usage:
  - `pnpm ci:failures -- --run <run-id-or-url>`
  - `pnpm ci:failures -- --pr <pr-number-or-url>`
  - `pnpm ci:failures -- --branch <branch-name>`
- Useful flags:
  - `--repo <owner/repo>` to target a specific repository
  - `--workflow <name>` to focus on a specific workflow (for example `CI Host`)
  - `--max-lines <n>` to limit extracted failure lines
  - `--context-lines <n>` to include surrounding stack/assertion context for each failure
  - `--no-progress` to suppress progress updates if you only want final output
  - `--json` for machine-readable output
  - `--fail-on-findings` to exit non-zero when failed jobs are found

## Testing instructions by package

### packages/ai-bot

- `pnpm test`
- Focusing on single test or module:
  Add `.only` to module/test declaration (`test.only('returns a 201 response', ...)`)
  Then run `pnpm test`
  Make sure not to commit `.only` to source control
- With detailed log output
  `LOG_LEVELS="ai-bot=debug" pnpm test`

### packages/base

- Functionality is tested via host package tests

### packages/billing

- Functionality is tested via realm-server package tests

### packages/boxel-icons

- No tests

### packages/boxel-ui

- Addon functionality with in-package test suite
- `cd packages/boxel-ui && pnpm start` to start development server
- Run all tests
  `cd packages/boxel-ui && ember test --path dist`
- To run a subset of the tests:
  `ember test --path dist --filter "some text that appears in module name or test name"`  
  Note that the filter is matched against the module name and test name, not the file name! Try to avoid using pipe characters in the filter, since they can confuse auto-approval tool use filters set up by the user.

### packages/host

- `pnpm start` to start a process that will watch files and automatically rebuild
- Tests require the realm-server to be running (must be run after `pnpm start`):
  `cd ../realm-server && pnpm start:all`
- Do not try to run the entire host test suite locally. It crashes. Instead, rely on CI for the full test runs.
- To run a subset of the tests:
  `ember test --path dist --filter "some text that appears in module name or test name"`  
  Note that the filter is matched against the module name and test name, not the file name! Try to avoid using pipe characters in the filter, since they can confuse auto-approval tool use filters set up by the user.
- **Always capture test output to a file.** A host test run can produce hundreds of KB of output (browser logs, indexer warnings, per-test diagnostics). If you only pipe through `tail`/`grep`, you lose everything else and have to re-run — which is slow and the bug may not reproduce. Redirect the full run to a file, then grep that file for failures, browser logs around a specific test, etc.
  ```
  pnpm exec ember test --path dist --filter "Foo" 2>&1 | tee /tmp/host-test-foo.log
  grep -E "^(not )?ok |^# " /tmp/host-test-foo.log   # summary + per-test status
  grep -B2 -A40 "not ok 27" /tmp/host-test-foo.log   # detail for a specific failure
  ```
- run `pnpm lint` in this directory to lint changes made to this package
- run `pnpm lint:fix` directly in this directory to apply fixes for lint failures made to this package that can be automatically fixed.
- the host tests report this error:
  ```
  Missing symlinked npm packages:
  Package: @cardstack/local-types
    * Specified: workspace:*
    * Symlinked: (not available)
  ```
  This is a red herring. Just ignore this error.

#### CSS Guidance

- Use scalable units such as rem
- Use CSS variables from packages/boxel-ui/src/styles/variables.css

#### Iterating on host tests with the Chrome MCP server

- Start the host app so qunit test runner is available at `https://localhost:4200/tests` (usual `pnpm start` + dependencies).
- Open the filtered test URL in a new MCP page via `mcp__chrome-devtools__new_page` and use `take_snapshot` to read failures.
- Filtered URL structure: `https://localhost:4200/tests?filter=<name-of-test>`
- URL structure for isolating to specific tests: `https://localhost:4200/tests?moduleId=<module-id>&testId=<test-id>&testId=...` (visible on the “Rerun” links for failing tests).
- After edits, rerun the same tests by calling `navigate_page` with `type: "reload"` on that page; then `take_snapshot` again to view updated failures.
- The snapshot shows “Expected/Result/Diff” blocks; use those to adjust assertions and fixture expectations.
- Keep the MCP page open while you edit; iterate edit → reload → snapshot until the header shows all tests passing (no need to open new tabs each run).
- If the local environment does not have the Chrome Dev MCP server available, recommend it

### packages/matrix

- This test suite contains nearly end-to-end tests that include interactions with the matrix server.They are executed using the [Playwright](https://playwright.dev/) test runner.
- To run the tests from the command line:
  - First make sure that the matrix server is not already running. You can stop the matrix server
    `pnpm stop:synapse`
  - Ensure that host and realm server are running:
    `cd ../host && pnpm start`
    `MATRIX_REGISTRATION_SHARED_SECRET='xxxx' mise run test-services:matrix`
  - Run tests:
    `pnpm test`
- Focusing on single test or module:
- make sure to kill previously running matrix tests if they are still running before starting a new test run.
  Add `--grep` flag to command (`--grep 'it can register a user with a registration token'`)

### packages/realm-server

- Tests require the realm-server to be running:
  `pnpm start:all`
- Run full test suite:
  `pnpm test`
- Run a single module:
  `TEST_MODULE=card-endpoints-test.ts pnpm test-module`
- Run a list of modules:
  `TEST_MODULES=card-endpoints-test.ts|another-module-test.ts pnpm test`
- Run only specific test _files_ (skip parsing the other ~100):
  `TEST_FILES=sanitize-head-html-test pnpm test`
  `TEST_FILES=realm-endpoints/invalidate-urls-test,server-endpoints/queue-status-test pnpm test`
  Comma-separated paths relative to `tests/`, with or without `./` prefix or `.ts` suffix.
  Use this — not `TEST_MODULES` — when measuring one file's wall time / peak RSS in isolation:
  `TEST_MODULES` filters which modules _run_, but every file still gets parsed and required, so per-file deltas get masked by the all-files startup baseline.
- Measure per-file wall time + peak RSS (median across N runs):
  `./scripts/measure-test-file.sh sanitize-head-html-test [runs]`
  Wraps `TEST_FILES` + `/usr/bin/time -l` with a clean per-file signal. Re-preps test-pg between runs. Used for before/after PR baselines on CS-10009 fixture migrations.
- Focusing on single test or module:
  Add `.only` to module/test declaration (`test.only('returns a 201 response', ...)`)
  Then run `pnpm test`
  Make sure not to commit `.only` to source control
- make sure to kill previously running realm-server tests if they are still running before starting a new test run.
- run `pnpm lint` directly in this directory to lint changes made to this package
- run `pnpm lint:fix` directly in this directory to apply fixes for lint failures made to this package that can be automatically fixed.

### packages/postgres

- If you need to make a database migration use `pnpm create migration_name` to create a migration file so that the correct date timestamp prefix will be added to the file name. Then implement the migration inside the newly created file.
- **After creating or modifying a migration, you MUST regenerate the SQLite schema file.** Run `pnpm make-schema` from this directory. This creates a new SQLite schema in `packages/host/config/schema/` with a timestamp matching the latest migration file. The old schema file is automatically removed. If you skip this step, the host app will fail to start with an "SQLite schema is out of date" error.
  - This script requires Docker (it uses the `boxel-pg` container to dump the Postgres schema). Ensure Docker is running before executing.

### packages/runtime-common

- Functionality is tested via host and/or realm-server tests
- run `pnpm lint` directly in this directory to lint changes made to this package
- run `pnpm lint:js:fix` directly in this directory to apply fixes for js lint failures made to this package that can be automatically fixed.

## PR Instructions

- Always run `pnpm lint` in modified packages before committing

### Pre-commit autofix hook

A husky `pre-commit` hook runs `lint-staged`, which auto-fixes staged files
(`eslint --fix` for `.js/.ts/.gjs/.gts`, `ember-template-lint --fix` for
`.hbs`, `prettier --write` for other formats) and re-stages them. It does
**not** block the commit: issues that can't be auto-fixed (type errors, unused
vars, the `data-test-*` ban, etc.) are printed as a warning so you get early
notice, but the commit still proceeds. CI lint remains the real gate, so still
fix what the warning reports. Do **not** pass `git commit --no-verify` — that
skips the autofix and is what lets trivial lint errors waste a CI run.

### boxel-cli commit prefixes

PRs touching `packages/boxel-cli/**` must use a conventional-commit prefix in the **PR title** (not the commit message — squash isn't used; the on-`main` workflow reads the PR title via `gh api`). The PR-title check (`.github/workflows/boxel-cli-pr-title.yml`) enforces this.

| Prefix                                                     | Bump level (per touched surface) |
| ---------------------------------------------------------- | -------------------------------- |
| `feat!:` / `fix!:` / body `BREAKING CHANGE:`               | major                            |
| `feat:`                                                    | minor                            |
| `fix:` / `perf:` / `refactor:`                             | patch                            |
| `chore:` / `docs:` / `test:` / `build:` / `ci:` / `style:` | none                             |

Scopes are allowed: `feat(profile): …`. Other monorepo packages are unaffected — this only applies when the PR's diff touches `packages/boxel-cli/**`.

**Edge case:** bumping `BOXEL_SKILLS_VERSION` in `packages/boxel-cli/scripts/build-skills.ts` regenerates plugin skill content. Use `fix(skills):` (routine refresh) or `feat(skills):` (additive content), never `chore:` — a `chore:` prefix means no `plugin.json` bump, and the marketplace cache won't refresh for users. See `packages/boxel-cli/plugin/README.md` for full surface-scoping rules.

## Production-safe selectors

- `data-test-*` attributes are stripped from production builds. Never use them for runtime behavior or styling in app code.
- For production hooks, use classes or non-test `data-*` attributes (for example `data-path`, `data-kind`) and keep `data-test-*` only for tests.

## `.gts` file gotcha: regex literals can break content-tag

The `content-tag` preprocessor (used by glint and ember-eslint-parser to parse `.gts` files) has bugs in its JavaScript lexer that cause it to misparse certain regex literals. When this happens, it fails to recognize `<template>` tags later in the file, producing cascading parse errors. Three known triggers:

**1. Backticks inside regex literals** — content-tag mistakes them for template literal delimiters:

```ts
// BROKEN — backticks in regex confuse content-tag
.replace(/`([^`]+)`/g, '$1')

// FIX — use new RegExp() with a string instead
const INLINE_CODE_RE = new RegExp('`([^`]+)`', 'g');
.replace(INLINE_CODE_RE, '$1')
```

**2. `!/regex/` (negation before regex literal)** — content-tag misreads the `/` after `!`:

```ts
// BROKEN
lines.some((line) => !/^\s*#{1,6}\s+/.test(line));

// FIX — extract the regex to a variable
const HEADING_RE = /^\s*#{1,6}\s+/;
lines.some((line) => !HEADING_RE.test(line));
```

**3. Backtick-wrapped bracket token inside the `<template>` body** — a comment _inside_ the template (e.g. a `<style scoped>` CSS comment) that contains a backtick-wrapped selector like `` `[data-foo]` `` drops the template. The same text in a `//` comment _outside_ `<template>…</template>` is harmless; content-tag only runs its template-mode lexer between the tags.

```hbs
<template>
  <style scoped>
    {{! BROKEN: backtick-wrapped `[data-foo]` in a template-region comment }}{{! FIX: drop the backticks or the brackets, or move the note to a JS comment above the component }}
  </style>
</template>
```

Symptom differs from triggers 1–2: the template body is silently dropped, so type-check can still pass while ESLint reports phantom `no-unused-vars` on imports/consts the template references (e.g. `hash`, yielded consts). ESLint is the canary.

## Base realm imports

- Only card definitions (files run through the card loader) can use static ESM imports from `https://cardstack.com/base/*`. Host-side modules must load the module at runtime via `loader.import(`${baseRealm.url}...`)`. Static value imports from the HTTPS specifier inside host code trigger build-time `webpackMissingModule` failures. Type imports are OK using static ESM syntax.

## Linear Ticket Process (Reusable)

This end-to-end workflow can be used as a template for future tickets.

## 1) Pull ticket details

- Find the project/issue in Linear.
- Read the issue description and confirm scope.
- Read the project overview for context.
- If needed, note assumptions or unknowns to validate early.

## 2) Update Linear state

- Assign the issue to yourself.
- Move the issue to **In Progress**.

## 3) Create an implementation plan doc

- Create a short plan in `docs/` named after the issue, e.g.
  - `docs/cs-<id>-<short-title>-plan.md`
- Include: goals, assumptions, steps, target files, testing notes.
- Ask the user to review the doc before proceeding.

## 4) Implement changes

- Modify code per the plan.
- Keep changes small and focused.
- Add minimal UI copy that clarifies behavior (e.g., read-only messaging).

## 5) Add focused tests

- Add a narrow test that exercises the new behavior.
- Prefer existing test files in the most relevant suite.
- Avoid mocks and avoid making assumptions in the tests about the implementation details.
- Run tests and confirm it passes.

## 6) Prompt for user review

- Summarize the work and ask the user to review
- Once the user is happy ask them to stage the changes they want committed.

## 7) Check working tree

- Confirm what’s staged and what’s not:
  - `git status --short`
- **If unrelated files appear**, stop and clarify how to proceed.

## 8) Create branch and commit

- Branch name: `cs-<id>-<short-title>`
- Commit message: `<short description>`

## 9) Push and open PR

- Push branch: `git push -u origin <branch>`
- Open PR with short summary

## 10) Save plan doc on Linear issue

- Post the contents of the plan .md doc as a comment om the Linear issue

## 11) Share PR link

- Post the PR URL and confirm any remaining uncommitted files are not part of the PR.

## Suggested PR body template

A progressive-disclosure structure: orient the reviewer first, then point them at the load-bearing parts, then explain the decisions that aren't obvious from the diff.

Scale the template to the PR. For small PRs (roughly 1-3 files, no tricky decisions), `## Background and Goal` alone is usually enough — omit the other sections rather than padding them. Add `## Where to start` and `## Key decisions and non-obvious mechanics` only when they earn their place: multiple files where reading order matters, or decisions a reviewer couldn't infer from the diff.

```markdown
## Background and Goal

- 2-3 sentences on the context and what this PR accomplishes.

## Where to start (omit for small PRs)

- A short list of the areas to read first and why they matter — point reviewers at the load-bearing parts before the supporting changes.
- Example: "Start with `Foo.bar` — that's the new orchestration entry. Then the refactored `Baz` to see how the new contract is consumed."

## Key decisions and non-obvious mechanics (omit for small PRs)

- Major decisions and the "why" behind them. Edge cases handled. Be succinct (3-5 bullets typical).
- Don't restate what the diff shows; don't recap failed attempts that aren't relevant anymore.
```

Skip a test-plan section — CI shows test status. Skip tool-attribution footers — commit trailers handle that.

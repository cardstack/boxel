# Instructions for AI Agents

## Tooling prerequisites

- We pin the toolchain with Volta (`.volta`), using the versions of Node.js and pnpm specified in package.json. Install Volta and set `VOLTA_FEATURE_PNPM=1` so pnpm is managed automatically—avoid global installs outside Volta.
- pnpm is required for all scripts; use the pinned version as specified above.
- Docker is required (Postgres, Synapse, SMTP, Stripe CLI container). Ensure the daemon is running and you can run `docker` without sudo.

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

### packages/boxel-ui/addon, packages/boxel-ui/test-app

- Addon functionality is tested via sibling test-app directory
- `cd packages/boxel-ui/addon && pnpm start` to start a process that will watch files and automatically rebuild the addon
- `cd packages/boxel-ui/test-app && pnpm start` to start a process that will watch files and automatically rebuild the test-app
- Run all tests
  `cd packages/boxel-ui/test-app && ember test --path dist`
- To run a subset of the tests:
  `ember test --path dist --filter "some text that appears in module name or test name"`  
  Note that the filter is matched against the module name and test name, not the file name! Try to avoid using pipe characters in the filter, since they can confuse auto-approval tool use filters set up by the user.

### packages/catalog-realm

- Functionality is tested via host package tests

### packages/host

- `pnpm start` to start a process that will watch files and automatically rebuild
- Tests require the realm-server to be running (must be run after `pnpm start`):
  `cd ../realm-server && pnpm start:all`
- Do not try to run the entire host test suite locally. It crashes. Instead, rely on CI for the full test runs.
- To run a subset of the tests:
  `ember test --path dist --filter "some text that appears in module name or test name"`  
  Note that the filter is matched against the module name and test name, not the file name! Try to avoid using pipe characters in the filter, since they can confuse auto-approval tool use filters set up by the user.
- run `pnpm lint` in this directory to lint changes made to this package

#### Iterating on host tests with the Chrome MCP server

- Start the host app so qunit test runner is available at `http://localhost:4200/tests` (usual `pnpm start` + dependencies).
- Open the filtered test URL in a new MCP page via `mcp__chrome-devtools__new_page` and use `take_snapshot` to read failures.
- Filtered URL structure: `http://localhost:4200/tests?filter=<name-of-test>`
- URL structure for isolating to specific tests: `http://localhost:4200/tests?moduleId=<module-id>&testId=<test-id>&testId=...` (visible on the “Rerun” links for failing tests).
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
    `cd ../realm-server && MATRIX_REGISTRATION_SHARED_SECRET='xxxx' pnpm start:services-for-matrix-tests`
  - Run tests:
    `pnpm test`
- Focusing on single test or module:
  Add `--grep` flag to command (`--grep 'it can register a user with a registration token'`)

### packages/realm-server

- Tests require the realm-server to be running:
  `pnpm start:all`
- Run full test suite:
  `pnpm test`
- Run a single module:
  `TEST_MODULE=card-endpoints-test.ts pnpm test-module`
- Focusing on single test or module:
  Add `.only` to module/test declaration (`test.only('returns a 201 response', ...)`)
  Then run `pnpm test`
  Make sure not to commit `.only` to source control
- run `pnpm lint` directly in this directory to lint changes made to this package

### packages/runtime-common

- Functionality is tested via host and/or realm-server tests
- run `pnpm lint` directly in packages/host or directly in packages/realm-server to lint for changes made in this package. This package will be linted since both packages/host and package/realm-server consume this package.

## PR Instructions

- Always run `pnpm lint` in modified packages before committing

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

## 10) Share PR link

- Post the PR URL and confirm any remaining uncommitted files are not part of the PR.

## Suggested PR body template

```
## Summary
- <bullet 1>
- <bullet 2>
```

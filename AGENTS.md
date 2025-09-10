# Instructions for AI Agents

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

### packages/runtime-common

- Functionality is tested via host and/or realm-server tests

## PR Instructions

- Always run `pnpm lint` in modified packages before committing

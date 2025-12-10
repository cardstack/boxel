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

# Software Factory

Local card-development harness for fast Boxel iteration.

This package gives you a cached local realm fixture, a fixed-port isolated realm
server, and a Playwright loop that exercises cards in the real browser app
shell.

## Prerequisites

This package is TypeScript-only. New scripts, tests, and package utilities
should be written in `.ts`, not `.mjs`.

Editor/type support for `.gts` files is provided through `glint` via this
package's `tsconfig.json`, matching the realm-package pattern used elsewhere in
the repo. Package linting still uses `tsc` for the package TypeScript
entrypoints and tests.

- Docker running
- Host app assets available at `http://localhost:4200/`
  - use `cd packages/host && pnpm serve:dist`

The harness starts its own seeded test Postgres, Synapse, prerender server, and
isolated realm server. By default it serves the test realm and base realm from
the same fixed realm-server origin. The skills realm can be enabled when needed
with `SOFTWARE_FACTORY_INCLUDE_SKILLS=1`.

For the software-factory Playwright flow, the isolated realm stack is intended
to be self-contained on `http://localhost:4205/`. The fixture realms and test
startup do not require a separate external realm server on `http://localhost:4201/`.

## Commands

- `pnpm cache:prepare`
  - Builds or reuses the cached template database for `test-fixtures/darkfactory-adopter/`
- `pnpm serve:support`
  - Starts shared support services and prepares a reusable runtime context in the background
- `pnpm serve:realm`
  - Starts the isolated realm server on `http://localhost:4205/test/`
- `pnpm smoke:realm`
  - Boots the isolated realm server, fetches `project-demo` as card JSON, and exits
- `pnpm factory:go -- --brief-url <url> --target-realm-path <path>`
  - Validates one-shot factory inputs and prints a machine-readable run summary
- `pnpm test`
  - Runs package tests from `tests/*.test.ts` and `tests/*.spec.ts`
- `pnpm test:node`
  - Runs only Node-side `tests/*.test.ts`
- `pnpm test:playwright`
  - Runs the browser tests against a fresh per-test realm server cloned from the cached template
- `pnpm test:realm -- --realm-path ./realms/<project-realm>`
  - Runs realm-hosted Playwright specs via the typed realm test runner
- `pnpm boxel:session`
  - Prints browser session/auth payloads for the active Boxel profile
- `pnpm boxel:search -- --realm <realm-url> ...`
  - Runs a typed `_search` query against a realm
- `pnpm boxel:pick-ticket -- --realm <realm-url> ...`
  - Finds candidate tracker tickets in a target realm

All commands accept an optional realm directory argument:

```bash
pnpm cache:prepare ./my-realm
pnpm serve:realm ./my-realm
pnpm smoke:realm ./my-realm Person/example-card
```

## `factory:go`

Usage:

```bash
pnpm factory:go -- \
  --brief-url http://localhost:4201/software-factory/Wiki/sticky-note \
  --target-realm-path /path/to/target-realm \
  [--target-realm-url http://localhost:4201/hassan/personal/] \
  [--mode implement]
```

Parameters:

- `--brief-url`
  - Required. Absolute URL for the source brief card the factory should use as input.
- `--target-realm-path`
  - Required. Local filesystem path to the Boxel realm where the factory should write output.
- `--target-realm-url`
  - Optional. Absolute URL for that target realm when it is already known and should be included in the execution summary.
- `--mode`
  - Optional. One of `bootstrap`, `implement`, or `resume`. Defaults to `implement`.
- `--help`
  - Optional. Prints the command usage and exits.

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
- Each Playwright test still starts a fresh realm server and fresh runtime
  database cloned from the cached template DB, so server-side mutations do not
  leak across tests.
- Playwright keeps the support services alive for the whole run and only restarts the realm server/runtime DB per test.
- The browser tests seed a deterministic local Matrix user
  (`software-factory-browser`) so they do not depend on a human-managed profile.
- Host requests for the base realm URL are redirected to the isolated realm
  server. Skills redirects are only enabled when
  `SOFTWARE_FACTORY_INCLUDE_SKILLS=1`.
- The test fixtures should point at the isolated `4205` software-factory source
  realm directly, so they do not depend on any ambient external realm server.

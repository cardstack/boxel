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
the repo. Package linting currently runs `glint`, `eslint`, and `prettier`.

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
- `pnpm factory:go -- --brief-url <url> --target-realm-url <url>`
  - Fetches and normalizes a brief, bootstraps the target realm, and prints a machine-readable run summary
- `pnpm test`
  - Runs package tests from `tests/*.test.ts` and `tests/*.spec.ts`
- `pnpm test:node`
  - Runs only Node-side `tests/*.test.ts`
- `pnpm test:playwright`
  - Runs the browser tests against the software-factory Playwright harness
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
  --target-realm-url http://localhost:4201/hassan/personal/ \
  [--realm-server-url http://localhost:4201/] \
  [--mode implement]
```

Parameters:

- `--brief-url`
  - Required. Absolute URL for the source brief card the factory should use as input.
  - The command fetches card source JSON from this URL and includes normalized brief metadata in the summary.
- `--target-realm-url`
  - Required. Absolute URL for the target realm the factory should bootstrap and later populate.
- `--realm-server-url`
  - Optional. Explicit realm server URL for target-realm bootstrap when it cannot be inferred unambiguously from the target realm URL.
- `--mode`
  - Optional. One of `bootstrap`, `implement`, or `resume`. Defaults to `implement`.
- `--help`
  - Optional. Prints the command usage and exits.

Auth:

- `MATRIX_USERNAME` is required and determines the target realm owner.
- If the brief is in a public realm, you do not need any auth setup.
- If the brief is in a private realm, `factory:go` can authenticate using:
  - the active Boxel profile in `~/.boxel-cli/profiles.json`
  - `MATRIX_URL`, `MATRIX_USERNAME`, `MATRIX_PASSWORD`, and `REALM_SERVER_URL`
- When the target realm does not exist yet, `factory:go` creates it with `POST /_create-realm`.
- By default the target realm server URL is inferred from `--target-realm-url`, but `--realm-server-url` can override that when the realm server is mounted under a subdirectory.
- The realm-server `/_create-realm` contract is the readiness boundary for bootstrap.

Private brief with explicit Matrix username/password env:

```bash
export MATRIX_URL=http://localhost:8008/
export MATRIX_USERNAME=factory
read -s MATRIX_PASSWORD'?Matrix password: '
export MATRIX_PASSWORD
export REALM_SERVER_URL=http://localhost:4201/

pnpm factory:go -- \
  --brief-url http://localhost:4201/software-factory/Wiki/sticky-note \
  --target-realm-url http://localhost:4201/factory/personal/ \
  --realm-server-url http://localhost:4201/
```

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

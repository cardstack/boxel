# Software Factory

Local card-development harness for fast Boxel iteration.

This package gives you a cached local realm fixture, a fixed-port isolated realm
server, and a Playwright loop that exercises cards in the real browser app
shell.

## Prerequisites

- Docker running
- Host app assets available at `http://localhost:4200/`
  - use `cd packages/host && pnpm serve:dist`

The harness starts its own seeded test Postgres, Synapse, prerender server, and
isolated realm server. By default it serves the test realm and base realm from
the same fixed realm-server origin. The skills realm can be enabled when needed
with `SOFTWARE_FACTORY_INCLUDE_SKILLS=1`.

## Commands

- `pnpm cache:prepare`
  - Builds or reuses the cached template database for `demo-realm/`
- `pnpm serve:support`
  - Starts shared support services and prepares a reusable runtime context in the background
- `pnpm serve:realm`
  - Starts the isolated realm server on `http://localhost:4205/test/`
- `pnpm smoke:realm`
  - Boots the isolated realm server, fetches `person-1` as card JSON, and exits
- `pnpm test:playwright`
  - Runs the browser tests against a fresh per-test realm server cloned from the cached template

All commands accept an optional realm directory argument:

```bash
pnpm cache:prepare ./my-realm
pnpm serve:realm ./my-realm
pnpm smoke:realm ./my-realm Person/example-card
```

## Layout

- `demo-realm/`
  - Example card definitions and instances
- `src/harness.ts`
  - Cached template DB creation and isolated realm server startup
- `tests/`
  - Playwright fixtures and browser specs

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

# Software Factory

Local card-development harness for fast Boxel iteration.

This package gives you a cached local realm fixture, a realm server boot path
that mirrors the test harness, and a Playwright loop that exercises the card in
the real browser app shell.

## Prerequisites

- Docker running for the cached test Postgres on `127.0.0.1:55436`
- Host app assets available at `http://localhost:4200/`
- Base realm available at `http://localhost:4201/base/`
- Matrix available at `http://localhost:8008/`

Those are the same local services the realm-server tests expect.

## Commands

- `pnpm cache:prepare`
  - Builds or reuses the cached template database for `demo-realm/`
- `pnpm serve:realm`
  - Starts the realm server on `http://127.0.0.1:4444/`
- `pnpm smoke:realm`
  - Boots the realm server, fetches `person-1` as card JSON, and exits
- `pnpm test:playwright`
  - Runs the browser test against the cached local realm

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
  - Cached template DB creation and realm server startup
- `tests/`
  - Playwright fixtures and browser specs

## Notes

- Template DBs are intentionally reused across runs while the realm-server
  codebase stays stable.
- The browser test seeds a deterministic local Matrix user
  (`software-factory-browser`) so it does not depend on a human-managed profile.

---
name: environment-mode
description: Run a Boxel stack and its tests in an isolated local "environment mode" so you can validate a branch on this machine instead of waiting for CI. Use whenever you want to run a focused subset of realm-server or host tests against the current branch locally, boot the dev stack from a non-primary worktree without clobbering another stack, or the user asks to "run the tests locally", "spin up an isolated environment", or "test this without pushing". Covers worktree setup, the `BOXEL_ENVIRONMENT` slug rule, fast startup with `INDEX_CACHE`, service hostnames, running each test suite (and which ones don't work yet), and teardown.
allowed-tools: Read, Grep, Glob, Bash
---

# Environment mode

"Environment mode" runs a complete, isolated Boxel stack (realm-server, workers, prerender, Synapse, Postgres, host app) on this machine, keyed off the `BOXEL_ENVIRONMENT` variable. It exists so multiple environments — typically one per Git worktree — can run at once without colliding, and so you can validate a branch locally instead of pushing and waiting for CI.

When `BOXEL_ENVIRONMENT` is set, every service uses **dynamic ports** and registers with a **Traefik** reverse proxy that gives each environment its own `*.localhost` hostnames, plus a per-environment database. All of this is computed in `mise-tasks/lib/env-vars.sh` (sourced automatically by every mise task); the slug logic lives in `scripts/env-slug.sh`. Those two files are the source of truth — read them if a value here looks stale.

## The one hard rule

When booting any service or running any test that spins up real services from a worktree that is **not** the user's primary checkout, set `BOXEL_ENVIRONMENT=<worktree-slug>` first — the slug of the **current** worktree, never another one.

- The slug is the lowercased, sanitized form of `BOXEL_ENVIRONMENT` (`scripts/env-slug.sh`): `/` and non-alphanumerics become `-`. So `feature/My-Branch` → `feature-my-branch`. In practice, use the worktree's directory name under `boxel-motion-worktrees/`.
- Without it, the worktree falls back to **standard mode** (fixed ports 4201/4202, DB `boxel`, Synapse on `:8008`) and stomps on whatever stack is already running there.
- Pure unit tests, lint, typecheck, and `pnpm make-schema` do **not** need it.

To find what's already running and its slug:

```bash
docker ps --format '{{.Names}}' | grep boxel-synapse
# boxel-synapse-<slug>  → an env-mode stack for <slug>
# boxel-synapse         → a bare standard-mode stack
```

## Service hostnames (env mode)

Traefik terminates TLS, so everything is **https** (see `env-vars.sh`):

| Service       | Hostname                                      |
| ------------- | --------------------------------------------- |
| Host app      | `https://host.<slug>.localhost`               |
| Realm server  | `https://realm-server.<slug>.localhost`       |
| Test realm    | `https://realm-test.<slug>.localhost`         |
| Matrix        | `https://matrix.<slug>.localhost`             |
| Worker mgr    | `https://worker.<slug>.localhost`             |
| Icons         | `https://icons.<slug>.localhost`              |

(The README's env-mode table still shows `http://` from before the HTTPS migration; trust `env-vars.sh`.) Databases are `boxel_<slug>` and `boxel_test_<slug>`.

## Setup (once per worktree)

```bash
git worktree add ../<slug>
ln -s "$(pwd)/packages/boxel-icons/dist" ../<slug>/packages/boxel-icons/dist  # skip slow icons rebuild
cd ../<slug>
pnpm install
```

A leaf cert is required (env mode speaks HTTPS only). If `https://*.localhost` requests fail TLS, provision it:

```bash
mise run infra:ensure-dev-cert
```

## Starting the stack

Single command (host app + realm server + all supporting services):

```bash
BOXEL_ENVIRONMENT=<slug> mise run dev-all
```

`dev` (no host app) and `dev-minimal` (skips experiments/catalog/homepage/submission realms for faster startup) also work. `SKIP_CATALOG=true` shaves more startup time.

### Fast startup with INDEX_CACHE

A cold start indexes every realm from scratch (slow). Pull a prebuilt index from CI's latest `main` instead:

```bash
INDEX_CACHE=true BOXEL_ENVIRONMENT=<slug> mise run dev-all
```

This downloads the latest `boxel_index` dump, remaps URLs to your environment, imports it, and sets `REALM_SERVER_FULL_INDEX_ON_STARTUP=false` (file watcher handles incremental updates). Requires an authenticated `gh` CLI.

## Running tests against the environment

Always prefix test commands with `BOXEL_ENVIRONMENT=<slug>`. For the actual filter flags per suite, follow `AGENTS.md` → "Testing instructions by package"; this section only adds the env-mode wrapper.

### Realm-server tests — supported

With the stack up (`BOXEL_ENVIRONMENT=<slug> mise run dev`), run a focused subset from `packages/realm-server`:

```bash
BOXEL_ENVIRONMENT=<slug> TEST_FILES=server-endpoints/queue-status-test pnpm test
BOXEL_ENVIRONMENT=<slug> TEST_MODULE=card-endpoints-test.ts pnpm test-module
```

### Host tests (subset) — supported

Start the dev stack with `BOXEL_ENVIRONMENT=<slug>`, then drive the QUnit runner at the env-mode host URL:

```
https://host.<slug>.localhost/tests?filter=<test-name>
```

Use the Chrome DevTools MCP loop documented in `AGENTS.md` ("Iterating on host tests with the Chrome MCP server"), pointed at this hostname. Run a **focused subset** — the full host suite still belongs in CI.

### Matrix tests — NOT supported in env mode

Matrix (Playwright) tests do **not** currently run correctly in environment mode. Run them in standard mode per `AGENTS.md` → `packages/matrix`, or rely on CI. Do not try to make the Matrix suite pass against an env-mode stack.

## Teardown

Stop all processes for an environment and clean up its Traefik config:

```bash
mise run stop-environment <slug>
mise run stop-environment <slug> --dry-run   # preview what would be killed
mise run stop-environment <slug> --drop-db   # also drop the per-env database to start fresh
```

## Gotchas

- **Wrong slug = collision.** Setting another worktree's slug points the helpers at that environment's DB/ports/Synapse data dir. Always use the current worktree's slug.
- **Cross-worktree Synapse data.** A running stack's Synapse data dir (`packages/matrix/synapse-data-<slug>/`) lives in *its* worktree. Pointing at another worktree's slug references a data dir that doesn't exist here.
- **Stale env vars across shells.** Switching a shell between env mode and standard mode in-place can leave stale derived vars; prefer a fresh shell. The standard-mode branch of `env-vars.sh` resets these on transition.
- **HTTPS only.** No HTTP fallback in env mode — if requests fail at the TLS layer, run `mise run infra:ensure-dev-cert`.

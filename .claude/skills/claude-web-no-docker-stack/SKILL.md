---
name: claude-web-no-docker-stack
description: Bring up the boxel stack and run the host / realm-server browser test suites inside a Claude Code web session whose egress policy blocks every container-registry blob CDN, so `docker pull` cannot fetch postgres, Synapse or smtp4dev. Use when a pull dies with "Forbidden" on a blob fetch (production.cloudfront.docker.com, pkg-containers.githubusercontent.com, an ECR cloudfront host), when `.devcontainer/claude-web-setup.sh` fails on `curl https://mise.run`, when the boxel-index-cache artifact will not download, or when asked to run host tests in a session that has no working Docker. Covers native postgres in place of boxel-pg, running with no Matrix, a mise stand-in, the service start order, and which tests this environment cannot run.
allowed-tools: Read, Grep, Glob, Bash
---

# Running the stack when no container image can be pulled

`.devcontainer/claude-web-start.sh` assumes the session snapshot already holds
the images and the toolchain. In a session provisioned without them — a fresh
container, or one whose setup script failed — three separate egress denials
land at once, and each one looks like a different problem:

| Symptom                                                         | Blocked host                                 |
| --------------------------------------------------------------- | -------------------------------------------- |
| `curl https://mise.run` → `CONNECT tunnel failed, response 403` | `mise.run`                                   |
| `docker pull postgres:16.3` → `failed to copy: … Forbidden`     | `production.cloudfront.docker.com`           |
| `docker pull ghcr.io/cardstack/boxel/postgres:16.3`             | `pkg-containers.githubusercontent.com`       |
| `docker pull public.ecr.aws/docker/library/postgres:16.3`       | `d2glxqk2uabbnd.cloudfront.net`              |
| Fetching the `boxel-index-cache` artifact from a CI run         | `productionresultssa*.blob.core.windows.net` |

Registry _manifests_ resolve — the pull gets as far as the layers and then
403s — so a failure reads like a corrupt image rather than a policy denial.
Confirm before working around anything:

```sh
curl -sS "$HTTPS_PROXY/__agentproxy/status" | head -40   # recentRelayFailures names the host
```

Per the proxy's own README, a 403/407 is an organization policy denial: report
it, don't retry it, and don't look for another mirror — every mirror's blobs
live behind one of the CDNs above.

What _is_ reachable, and is what this skill builds on: `nodejs.org`,
`registry.npmjs.org` (in the proxy's no-proxy list), the Ubuntu archive over
apt, and `github.com` over git.

## When to use

- A web session is asked to run host tests (or realm-server tests) and Docker
  is unusable.
- You need the stack up — a realm server, a prerender, the host app — to
  reproduce something, and the usual start script won't boot.
- Deciding whether a test failure you are seeing is real or an artifact of
  this environment (see [What this environment cannot run](#what-this-environment-cannot-run)).

**Not for a development machine.** Where Docker can pull, `mise run dev` and
`mise run test-services:host` are simpler, better tested, and give you Matrix —
use those. Nothing here changes them: this skill adds files under
`.claude/skills/` and modifies no task, script or config on the normal path.
The substitutions below (a shimmed `mise` on the system path, a postgres
cluster in `/var/lib`, a CA in the system trust store, a symlink in `/usr/bin`)
suit a disposable session container and nowhere else, so `claude-web-no-docker-bootstrap.sh`
refuses to run unless it is root in a Claude Code session container where
`docker pull` is broken — override with `BOXEL_NO_DOCKER_BOOTSTRAP=1` only if
you are certain. The `mise` shim is never installed system-wide: it lives in
its own directory, and only the env file the bootstrap writes puts that
directory on `PATH`.

## Use it

```sh
.claude/skills/claude-web-no-docker-stack/claude-web-no-docker-bootstrap.sh     # toolchain, certs, postgres, deps  (~5 min)
.claude/skills/claude-web-no-docker-stack/claude-web-no-docker-start-stack.sh   # services, blocks until realms are ready
```

Then, in any later shell:

```sh
. /tmp/boxel-env.sh
cd packages/host
pnpm build   # ~2 min; the suite runs from dist, not from source
CI=true ./node_modules/.bin/ember test --path dist --filter 'Integration | search resource'
```

**Rebuild before every run after an edit.** `ember test --path dist` reads
whatever is in `packages/host/dist`, so testing after a source change without
rebuilding reports a result for the previous build — a false pass or a false
failure, with nothing to indicate which. This is the `vite build --mode
development && ember test --path dist` pairing AGENTS.md prescribes, and it
applies to changes anywhere the bundle pulls from (`packages/runtime-common`
and `packages/base` included), not just to `packages/host`.

`CI=true` is not cosmetic: `testem.js` only passes `--no-sandbox` to Chrome
under it, and the session runs as root, where Chrome refuses to start without
that flag. It also switches testem to the TAP + xunit reporters, so the output
is greppable (`^not ok`) and a junit file lands in `junit/`.

To reproduce one CI shard exactly:

```sh
CI=true ./node_modules/.bin/ember test --path ./dist --query 'shard=9&shardCount=16'
```

## What the two scripts replace, and why

**Toolchain** — `mise.run` is blocked, so `claude-web-no-docker-bootstrap.sh` installs the node
pinned in `.mise.toml` straight from nodejs.org into `/opt/node<major>` and
lets that node's npm install the pinned pnpm.

**`mise` itself** — [`claude-web-no-docker-mise-shim.sh`](./claude-web-no-docker-mise-shim.sh) is
copied to `~/.local/share/boxel/no-docker-bin/mise`, which the generated
`/tmp/boxel-env.sh` puts first on `PATH`. Nothing outside a shell that sourced
that file is shadowed — but inside one the shim does take precedence over a
real `mise`, and has to: `MISE_SHIM_SKIP` is the only way to no-op
`infra:ensure-pg`, and a real `mise` would run that dependency and try to start
the container that cannot be pulled here. Everything under `mise-tasks/` is a plain shell script;
the only mise-specific parts are the `#MISE dir=` / `#MISE depends=` headers
and `.mise.toml`'s `[env] _.source` hook, so the shim reads those three and
passes the rest through. `mise run services:realm-server`, `mise run build:ui`
and the rest then work as written, which matters because the repo's own
scripts shell out to `mise run` internally. `MISE_SHIM_SKIP` makes a task a
no-op; `claude-web-no-docker-bootstrap.sh` sets it to `infra:ensure-pg`, the task that starts and
health-checks the container.

**Postgres** — the image already ships the PostgreSQL 16 _server_ binaries
(`/usr/lib/postgresql/16/bin`), only the container is unavailable.
`claude-web-no-docker-bootstrap.sh` runs `initdb` as the `postgres` user against
`/var/lib/boxel-pgdata`, on port 5435 (what `env-vars.sh` hands every service)
with the container's `max_connections = 400` — a full stack opens one pool per
process and the default 100 is not enough. Anything in the repo that reaches
postgres through `docker exec boxel-pg psql` (`scripts/import-cached-index.sh`,
`infra:ensure-db`, `ci:import-index`) will not work here; use `psql -h
127.0.0.1 -p 5435 -U postgres` directly.

**Matrix** — Synapse is a container, so there is none. The realm-server does
not log in to Matrix at boot (nothing calls `logInToMatrix`), so it starts and
serves realms normally. Two consequences: `MATRIX_REGISTRATION_SHARED_SECRET`
has to be set by hand, because the script that derives it reads Synapse's
local config and the realm-server exits at startup when it resolves empty; and
anything that authenticates a _user_ against the realm server fails (below).

**The index cache** — the `boxel-index-cache` artifact lives in Azure blob
storage, which is blocked, so every realm indexes live. Base is quick; skills
takes several minutes; `claude-web-no-docker-start-stack.sh` waits on both.

**Chrome** — the image has Playwright's chromium but no `google-chrome`, and
both `env-vars.sh` (for the prerender's puppeteer) and testem's launcher look
for one on the standard paths. `claude-web-no-docker-bootstrap.sh` symlinks it into `/usr/bin`.

**TLS** — unchanged from normal local dev, and mandatory: the realm-server and
vite serve HTTPS+HTTP/2 with no plain-HTTP fallback. `claude-web-no-docker-bootstrap.sh` installs
mkcert from apt, creates the NSS DB that `mkcert -install` needs before
Chromium will trust the CA (`infra:ensure-dev-cert` refuses to run until both
the system store and NSS hold it), issues the same SAN set that task issues,
and concatenates the agent-proxy CA with mkcert's root into one
`NODE_EXTRA_CA_CERTS` file — Node takes a single path, and the stack needs to
trust the proxy outbound and the leaf on loopback at the same time.

## Service start order

`claude-web-no-docker-start-stack.sh` does this; it is here for when you start
pieces by hand. It exits 2, rather than reporting the stack up, when every
realm but skills is ready — skills-dependent tests would otherwise fail with
404s that look like the code under test.

1. `icons` (4206) and the host dist (4200) — `packages/host/dist` must be
   built first; `pnpm --dir packages/host build` takes ~2 minutes.
2. `services:prerender-mgr` (4222), then `services:prerender` (4221). The
   prerender's standby pages navigate to the host dist, and everything
   downstream gates on the manager reporting a registered worker.
3. `services:worker`, then `services:realm-server -- --workerManagerPort=4210`
   → base, skills and openrouter on 4201.
4. `services:worker-test`, then `services:test-realms -- --workerManagerPort=4211`
   → `/test/` and `/node-test/` on 4202. The host suite loads fixtures from
   both.

Readiness is per realm, and the `Accept` header is required — without it the
endpoint 404s on a fully booted stack:

```sh
curl -sk -o /dev/null -w '%{http_code}\n' \
  -H 'Accept: application/vnd.api+json' https://localhost:4201/base/_readiness-check
```

## What this environment cannot run

Before reporting a failure as real, check it against this list — and confirm
by re-running the same test against `main`'s version of the changed files.

- **Anything that authenticates a user against a realm server.** Host tests use
  `setupMockMatrix` in the browser, but a few acceptance tests drive a real
  login round trip (`_realm-auth`, `_server-session`), and the realm-server
  needs Synapse to answer those. They fail here and pass in CI.
- **Percy snapshots.** No token; the helper no-ops.
- **Anything asserting on a cached index.** Realms index live, so
  `last-modified`-derived text and index-timing assertions can differ from CI,
  which imports a snapshot.
- **The matrix and realm-server node suites**, which start their own Synapse
  and smtp4dev containers.

## Cost

Bootstrap ≈ 5 minutes (node + pnpm install + `build:ui`). The host dist build
≈ 2 minutes. Stack boot to a ready base realm ≈ 2 minutes; skills adds several
more. A single host test module then runs in well under a minute; a full
16-way CI shard takes 20–40 minutes.

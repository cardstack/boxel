# @cardstack/observability

Self-host Grafana dashboards, alerts, and data sources as code, plus a local `docker-compose` stack (Grafana + Loki) for previewing changes before they hit staging.

## Project context

This package is the source of truth for the self-host Grafana stack.
Staging and production cut over from Amazon Managed Grafana (AMG) on
2026-05-06; the AMG-era Terraform workspace
`cardstack/infra:configs/boxel-dashboard/` is slated for decommission
in Phase 7 (CS-10942).

- [Linear: Replace dashboard with our own grafana](https://linear.app/cardstack/project/replace-dashboard-with-our-own-grafana-1b7e3de21dbf)
- Self-host Grafana Terraform: `cardstack/infra:configs/grafana/`
- Per-env data-source values: `cardstack/infra:configs/boxel-grafana-data-sources/`

## Architecture: two trees, two delivery mechanisms

There are **two source-of-truth trees** in this package, because Grafana 12 manages different resource kinds through different APIs:

| Tree                    | Tool                               | Resource kinds                            | Apply mechanism                                                |
| ----------------------- | ---------------------------------- | ----------------------------------------- | -------------------------------------------------------------- |
| `grafanactl/resources/` | `grafanactl resources push`        | Dashboards, folders                       | API push (CI on merge)                                         |
| `provisioning/`         | Grafana built-in file provisioning | Data sources, alert rules, contact points | Files mounted at `/etc/grafana/provisioning/`, read at startup |

**Why two trees?** `grafanactl` (Grafana Labs' official CLI replacing the archived Grizzly) only manages App Platform resources — `grafanactl resources list` shows dashboards, folders, playlists, snapshots, but **not data sources or alert rules**. Those still live behind the legacy HTTP API.

Locally, `provisioning/` files are mounted into the Grafana container by `docker-compose.yml` and read at startup with `${ENV_VAR}` substitution. **For staging and production, `apply-datasources.sh` reads the same YAML files, env-var-substitutes them (e.g. `${LOKI_URL}` from SSM `/<env>/loki/internal_url`), and upserts each entry through Grafana's `/api/datasources` HTTP API** — a small bridge that gives us file-as-source-of-truth without needing image bakes or EFS mounts on the hosted side.

## Layout

```
grafanactl/
  config.yaml          # context per env (local / staging / production)
                       # rendered to a tempfile per-call by scripts/render-config.sh
  resources/
    folders/           # grafanactl push: Grafana folder definitions
    dashboards/        # grafanactl push: dashboard JSON, organized by folder
provisioning/          # mounted into Grafana at /etc/grafana/provisioning/
  datasources/         # data sources (Loki, Postgres, CloudWatch, Prometheus)
  alerting/            # alert rule groups, contact points, notification policies
  local-only/          # local-dev overrides — bind-mounted file-by-file over
                       # `datasources/`. apply-datasources.sh ignores this dir.
collectors/
  actions-queue.ts     # samples the GitHub Actions REST API and prints one JSON
                       # line per observation on channel `boxel:actions-queue`;
                       # feeds the "GitHub Actions Queue" dashboard
alloy/
  config.alloy         # local log scraper config — discovers Docker containers
                       # and ships their stdout into Loki
loki/
  config.yaml          # local Loki config (single-node, filesystem, accepts
                       # historical Docker logs)
prometheus/
  prometheus.yml       # local Prometheus config — scrapes the dev synapse
                       # container's /metrics endpoint so the vendored Synapse
                       # dashboard works locally. Staging/prod use AMP via
                       # sigV4 and ignore this service.
scripts/
  apply.sh             # ./scripts/apply.sh --env <local|staging|production>
  apply-datasources.sh # internal — pushes provisioning/datasources/* via HTTP API
                       # (called by apply.sh; staging/production only)
  pull.sh              # ./scripts/pull.sh  --env <name> --path <dir>
  check.sh             # ./scripts/check.sh --env <name>  (connectivity smoke test)
  tail-logs.sh         # ./scripts/tail-logs.sh --env <name> --service <task family>
  dev-log-tee.sh       # internal — tees mise dev-task stdout into BOXEL_LOG_DIR
                       # so the local Alloy scraper can pick up native processes
  render-config.sh     # internal — renders grafanactl config.yaml per-invocation
  grafanactl-env.sh    # sourceable; exports GRAFANA_TOKEN from SSM for staging/prod
templates/
  env-vars.env.example
docker-compose.yml     # local Grafana 12.4.3 + Loki 3.4.4 + Alloy 1.10.0
                       #               + Prometheus 3.0.0 (scrapes synapse)
```

## Collectors

Some signals have no service to emit them, so a collector samples an external
API and prints the result as JSON log lines on stdout — the same shape every
other service logs in, so the existing Alloy (local) and FireLens (hosted)
pipelines carry it to Loki with no special handling.

### actions-queue

Samples GitHub Actions queue depth, per-job wait times and runner consumption.

```bash
GITHUB_TOKEN=$(gh auth token) node collectors/actions-queue.ts --once
GITHUB_TOKEN=$(gh auth token) node collectors/actions-queue.ts   # loops, default 60s
```

It emits four event types, all on channel `boxel:actions-queue`:

| `event_type`                             | one line per              | carries                                                                                     |
| ---------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------- |
| `job`                                    | queued or running job     | branch, actor, workflow, runner labels, `queued_seconds`, `running_seconds`, `current_step` |
| `group`                                  | dimension × key           | `dimension` (branch / actor / workflow), `key`, `queued`, `running`                         |
| `snapshot`                               | sample                    | `queued_jobs`, `running_jobs`, `active_runs`, `rate_limit_remaining`                        |
| `collector-error`, `collector-throttled` | failure or skipped sample | why the series has a gap                                                                    |

Grouped depth is emitted as its own lines rather than nested on the snapshot
because LogQL flattens nested JSON into one label per key, which for dynamic
keys like branch names produces a label per branch instead of a series that can
be grouped by branch.

Two constraints are load-bearing:

- **It must not run as a scheduled GitHub Actions workflow.** It would queue
  behind the backlog it measures and go blind during the incident it exists
  for. Hosted, it belongs on a schedule outside Actions.
- **A sample costs one request per active run, plus two.** The hourly spend
  therefore scales with how busy the repository is, against a token's 5,000
  requests an hour. At the observed peak of ~50 concurrent runs a 60-second
  interval spends around 3,200 an hour, which is comfortable; 30 seconds
  exceeds the budget above roughly forty concurrent runs, so higher resolution
  needs the per-sample cost reduced rather than the interval shortened.
  Sampling stops rather than reporting partial depth when the remaining budget
  nears its reserve.

The dashboard reads `{service="actions-collector", env="$env"}`, so a hosted
deployment needs to log under that service name.

#### Hosted

Runs as a small ECS service — `cardstack/infra:configs/boxel-actions-collector`
— rather than a scheduled task: the signal is standing state sampled every
couple of minutes, and a per-invocation Fargate task would spend longer
starting than working. FireLens applies `service=actions-collector`, which is
what the dashboard selects on.

Before the first apply, put a GitHub token at
`/<env>/boxel/ACTIONS_COLLECTOR_GITHUB_TOKEN` as a `SecureString`. It is
deliberately not managed by Terraform, like the other secrets on that path. The
collector accepts either that name or a plain `GITHUB_TOKEN`, which is the
convenient one locally.

The token's only job is the rate limit: these endpoints are readable without
authentication on a public repository, but unauthenticated callers get 60
requests an hour against the 5,000 an authenticated one gets, and a single
sample can cost sixty. So the token needs **no permissions** while `boxel` is
public — a fine-grained token scoped to _Public repositories (read-only)_, or
even a classic token with no scopes ticked, is enough. Were the repository ever
made private, it would need Actions: Read-only on it.

Build and deploy with the **Manual Deploy [actions-collector]** workflow. It is
`workflow_dispatch` only — putting the deploy of a queue sampler on a CI
trigger would make it queue behind the backlog it reports on.

## Local workflow

```sh
# One-time: install grafanactl
# macOS:
brew install --formula grafanactl
# Linux: download the prebuilt tarball from
# https://github.com/grafana/grafanactl/releases/latest and drop the
# binary on your PATH, e.g.:
#   curl -sSL -o /tmp/grafanactl.tgz \
#     https://github.com/grafana/grafanactl/releases/latest/download/grafanactl_Linux_x86_64.tar.gz
#   tar -xzf /tmp/grafanactl.tgz -C /tmp grafanactl
#   sudo install -m 0755 /tmp/grafanactl /usr/local/bin/grafanactl
# (swap `Linux_x86_64` for `Linux_arm64` on aarch64.)

# Bring up local Grafana + Loki + Alloy (log scraper) + Prometheus
docker compose up -d
# Grafana:    http://localhost:3001    (admin / admin)
# Loki:       http://localhost:3100
# Alloy:      http://localhost:12345   (target / pipeline debug UI)
# Prometheus: http://localhost:9090    (Synapse scrape targets)
#
# The Prometheus container joins the `boxel` Docker network so it can
# reach `boxel-synapse:9001`. That network is created as a side-effect
# of `mise run start-synapse`. If you bring up the observability stack
# BEFORE starting synapse for the first time, run
# `docker network create boxel` first.

# Verify connectivity
./scripts/check.sh --env local

# Apply local dashboards (matches what grafanactl pushes to staging/production)
./scripts/apply.sh --env local
```

In Grafana, run a LogQL query like `{env="local"}` against the Loki data
source to see lines from any other container running on the host.

> **Note**: the local Alloy pipeline drops Docker log entries older than
> 24 hours before they reach Loki. Loki itself is configured to accept
> historical entries (`reject_old_samples: false` in `loki/config.yaml`),
> but Alloy's `stage.drop { older_than = "24h" }` filter prevents the
> initial backfill of long-lived containers (e.g. a `boxel-pg` that's
> been up for months) from flooding Loki on first attach. Edit
> `alloy/config.alloy` and restart the stack if you want a wider window.

### Native dev processes (realm-server, worker, prerender, prerender-manager)

The boxel dev loop runs the realm-server, worker manager, prerender
server, and prerender manager **natively on the host** via mise tasks,
not in Docker — so the Alloy Docker-socket discovery above can't see
them. To bridge the gap, each of those four mise tasks tees its
stdout+stderr into a per-service file under `${BOXEL_LOG_DIR:-/tmp/boxel-logs}`:

```text
/tmp/boxel-logs/realm-server.log
/tmp/boxel-logs/worker.log
/tmp/boxel-logs/prerender.log
/tmp/boxel-logs/prerender-manager.log
```

`docker-compose.yml` bind-mounts that directory into the Alloy
container at `/var/log/boxel-host/`, and `alloy/config.alloy` has a
`loki.source.file` block that follows each path with
`{service=<name>, env="local"}` labels. The result: a freshly-booted
local realm-server's stdout shows up in `{env="local",
service="realm-server"}` within seconds, no extra dev-side setup.

```sh
# After `docker compose up -d` and `mise run dev`, verify in Grafana:
#   Explore → Loki → {env="local", service="realm-server"}
# Or via curl:
curl -sS 'http://localhost:3100/loki/api/v1/label/service/values' | jq
```

The wrapper that performs the tee is `scripts/dev-log-tee.sh`. It uses
`tee -a` (append) so the file's inode stays stable across `mise run`
restarts — Alloy's tail watcher keeps reading from where it left off,
without the truncation-induced offset confusion that `tee` (no `-a`)
caused in earlier iterations. The trade-off: log files grow across
runs; `rm "$BOXEL_LOG_DIR"/*.log` between runs if you want a clean
slate (then `docker compose restart alloy` so Alloy reattaches to the
freshly-created files). Loki queries are time-bounded anyway, so a few
hundred KB of accumulated log rarely matters in practice.

Override the directory by exporting `BOXEL_LOG_DIR` — but if you do,
set it for **both** `mise run` and `docker compose up`, otherwise the
bind-mount and the writer will disagree.

> **Permission gotcha (Linux)**: bind mounts can cause Docker to create
> `/tmp/boxel-logs` with root ownership before the mise tasks run. The
> wrapper script falls through to a passthrough `cat` in that case
> (printing a one-line warning to stderr) so the dev process keeps
> running, but local Loki won't see those services until you fix the
> ownership: `sudo rm -rf /tmp/boxel-logs` (or pick a path you own via
> `BOXEL_LOG_DIR`). On macOS Docker Desktop this rarely bites.

## Loki label schema

The label set is **load-bearing**: dashboards written in LogQL select on
these labels, so the local scraper, staging FireLens, and production
FireLens must all emit the same shape. Pick the schema once, here. If
you change it, change it everywhere — `alloy/config.alloy` (local) and
`cardstack/infra:modules/aws/ecs/firelens/templates/extra.conf.tftpl`
(staging + production).

| Label       | Local source                                                                                                                                                 | Staging / production source                                                                                                                                                   | When set                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `env`       | constant `local` — Alloy relabel rule (Docker source) and inline target attribute (file source)                                                              | constant `staging` / `production` (Fluent Bit static `Labels`)                                                                                                                | always                                   |
| `service`   | Docker container name, leading `/` stripped (Docker source) — or `realm-server` / `worker` / `prerender` / `prerender-manager` (file source, mise dev tasks) | ECS task family — `realm-server`, `worker`, `prerender`, `prerender-manager`, `synapse`                                                                                       | always                                   |
| `realm`     | opt-in via Docker label `boxel.realm=<name>`                                                                                                                 | task env when the task pins a single realm (omitted on multi-realm workloads)                                                                                                 | when meaningful                          |
| `worker_id` | not set locally                                                                                                                                              | per-process worker id (`<runtime-id>-pid-<pid>`), parsed from `[worker <id> priority N]:` log line prefixes by a Fluent Bit Lua filter. Matches `job_reservations.worker_id`. | worker tasks only, lines with the prefix |

The local Alloy scraper drops the observability stack's own Compose
services (`grafana`, `loki`, `alloy`) so `{env="local"}` queries don't
echo through a Grafana → Loki feedback loop.

To tag a custom local container so its lines pick up the `realm` label:

```sh
docker run --label boxel.realm=test_realm --name my-realm-worker ...
```

## Querying Loki

### Locally

Loki listens on `http://localhost:3100`. Either query in Grafana
(http://localhost:3001 → Explore → Loki), inspect metadata with curl,
or fetch log lines directly from the CLI:

```sh
# Metadata discovery
curl -sS 'http://localhost:3100/loki/api/v1/labels' | jq
curl -sS 'http://localhost:3100/loki/api/v1/label/service/values' | jq

# Fetch lines for one service over the last 15 minutes
END=$(date -u +%s)
START=$((END - 15 * 60))
curl -sS -G 'http://localhost:3100/loki/api/v1/query_range' \
  --data-urlencode 'query={service="my-realm-worker"}' \
  --data-urlencode "start=${START}000000000" \
  --data-urlencode "end=${END}000000000" \
  --data-urlencode 'limit=100' \
  --data-urlencode 'direction=backward' | jq
```

### Staging or production

The hosted Loki sits behind the Grafana ALB at the `/loki*` path, gated
by a bearer token written to SSM. Two pieces of `${ENV}` plumbing:

```sh
ENV=staging   # or production
TOKEN=$(aws ssm get-parameter --name /$ENV/loki/auth_token --with-decryption --query 'Parameter.Value' --output text)
BASE=$(aws ssm get-parameter --name /$ENV/loki/public_url --query 'Parameter.Value' --output text)
# BASE is e.g. https://dashboard-staging.stack.cards/loki
```

> **URL gotcha**: the ALB rule path (`/loki*`) and Loki's own API
> namespace (`/loki/api/v1/...`) happen to share the literal `/loki`
> segment. The right call shape is `$BASE/api/v1/labels`, which resolves
> to `https://.../loki/api/v1/labels` — Loki's native endpoint. Do not
> double the segment (`$BASE/loki/api/v1/labels` 404s).

```sh
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/labels" | jq
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/label/service/values" | jq
```

### LogQL cookbook

These run identically against local, staging, and production — only the
URL/token plumbing differs. Replace `<env>` with `local`, `staging`, or
`production`.

A LogQL selector by itself doesn't carry a time window — that comes
from the client (Grafana Explore's range picker, `tail-logs.sh
--since`, or `start`/`end` on the `query_range` HTTP API). The `[1d]`,
`[5m]` etc. inside `count_over_time(... [N])` are the _aggregation_
window, not the query window.

```logql
# All lines from the realm-server in the selected time range
{env="<env>", service="realm-server"}

# Errors in any service in the selected time range
{env="<env>"} |~ "(?i)error|exception|fatal"

# Lines for one realm across all services
{env="<env>", realm="example_realm"}

# Per-worker tail (worker_id matches job_reservations.worker_id —
# look it up there, e.g. for the worker that ran a specific job).
{env="<env>", service="worker", worker_id="abc123-3236013547-pid-42"}

# Logs around a specific job id (LogQL line-filter, not regex)
{env="<env>", service="worker"} |= "job_id=42"

# Error rate sliced by service — the [1d] is the aggregation window,
# the query time range still comes from the client
sum by (service) (count_over_time({env="<env>"} |~ "ERROR" [1d]))

# Slowest indexer batches (matches a known log shape)
{env="<env>", service="realm-server"} |~ "indexer.*duration_ms=[0-9]{4,}"

# Drop noisy keep-alive lines, keep the rest
{env="<env>", service="prerender"} != "GET /health"
```

Quoting: LogQL is JSON-y. Single-quote the whole expression in shell
to avoid escaping `"` and `$` inside the query.

### `tail-logs.sh`

`scripts/tail-logs.sh` wraps the curl shape above with auth + URL +
LogQL selector building pre-baked. Local mode hits the localhost Loki
without auth; staging / production fetch the bearer token and public
URL from SSM.

```sh
# Local — no auth, expects docker compose up from this directory
./scripts/tail-logs.sh --env local --service realm-server

# Tail staging worker errors
./scripts/tail-logs.sh --env staging --service worker --regex '(?i)error|exception'

# Drill to one job id
./scripts/tail-logs.sh --env staging --service worker --filter 'job_id=42' --since 1h --no-follow

# Production requires --confirm
./scripts/tail-logs.sh --env production --service synapse --since 30m --no-follow --confirm
```

| Flag                       | Default    | Notes                                                                                               |
| -------------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| `--env`                    | (required) | `local`, `staging`, `production`                                                                    |
| `--service`                | (required) | `realm-server`, `worker`, `prerender`, `prerender-manager`, `synapse` (or any local container name) |
| `--realm`                  | unset      | Restrict to a single realm.                                                                         |
| `--worker-id`              | unset      | Per-Fargate-task id; workers only.                                                                  |
| `--filter`                 | unset      | LogQL line-filter (`\|=`); literal substring.                                                       |
| `--regex`                  | unset      | LogQL line-regex (`\|~`). Mutually exclusive with `--filter`.                                       |
| `--since`                  | `15m`      | `30s`, `15m`, `1h`, `2d` — pattern `^\d+[smhd]$`.                                                   |
| `--limit`                  | `200`      | Max lines per batch.                                                                                |
| `--follow` / `--no-follow` | follow     | Default polls every 5 s until ctrl-C.                                                               |
| `--json`                   | text       | Raw Loki response per batch (pipe to jq).                                                           |
| `--confirm`                | n/a        | Required for `--env production`.                                                                    |

The same script powers the `tail-logs` Claude agent skill at
`.claude/skills/tail-logs/SKILL.md` — agents call the script with
`--no-follow` for diagnostics.

## Loki vs CloudWatch Logs Insights

Through the Phase 7 migration bake, every staging / production task
that ships to Loki **also** ships the same lines to CloudWatch — see
`cardstack/infra:modules/aws/ecs/firelens/templates/extra.conf.tftpl`,
the FireLens config emits two `[OUTPUT]` blocks per task. Pick which
backend to query based on what you're doing:

| Use case                                                              | Query target | Why                                                                                                              |
| --------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------- |
| Reproducing a dashboard panel locally                                 | Loki         | Dashboards under `grafanactl/resources/dashboards/` use LogQL — same syntax, same labels, same answer.           |
| Tailing live activity from a laptop                                   | Loki         | `tail-logs.sh` (CS-10920) / `logcli` keep the same labels and a uniform shell.                                   |
| Cross-service queries (e.g. "all errors in staging in the last hour") | Loki         | One label plane (`env=staging`) covers everything. CloudWatch needs a Logs Insights query per log group.         |
| Long-window forensics (>30 days)                                      | CloudWatch   | CloudWatch retention is set per-log-group on the existing infra; Loki's S3 lifecycle expires chunks at 180 days. |
| Pre-2026-05-06 saved query / runbook (AMG-era)                        | CloudWatch   | The CloudWatch shape didn't change — paste the old Logs Insights query and it still works through Phase 7.       |
| AWS-side troubleshooting (ECS Agent, FireLens itself)                 | CloudWatch   | Loki only sees the application's stdout. ECS-internal events are CloudWatch only.                                |

The dual-ship goes away (CloudWatch-only drop) in a follow-up ticket
once Loki has been load-bearing for a full release cycle.

## Hosted vs local Loki

| Trait                | Local                                                | Staging / production                                                          |
| -------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| Storage              | filesystem, named volume `loki_data`                 | S3 bucket `boxel-loki-chunks-<env>`                                           |
| Persistence          | survives `docker compose restart`; lost on `down -v` | indefinite, governed by S3 lifecycle                                          |
| Retention            | none enforced (devs prune manually)                  | transition to IA at 30 d, expire at 180 d (S3 lifecycle)                      |
| `reject_old_samples` | `false` (so backfills work)                          | `true` (default, ~7d window)                                                  |
| Auth                 | none                                                 | bearer token at the Grafana ALB (`/loki*` path rule); SG-only on internal NLB |
| Reachable from       | localhost only                                       | Grafana ECS tasks + FireLens log_router sidecars; laptops via the public path |

## Staging / production workflow

Tokens come from SSM at `/<env>/grafana/grafanactl_token` (provisioned by `cardstack/infra:configs/grafana/`). AWS creds with `ssm:GetParameter` on that path are required.

```sh
# Source the token for the env you're targeting
source ./scripts/grafanactl-env.sh staging

# Smoke-test connectivity
./scripts/check.sh --env staging

# Preview a change (dry-run)
./scripts/apply.sh --env staging --dry-run

# Round-trip the live state into a tempdir (for diff or audit)
./scripts/pull.sh --env staging --path /tmp/staging-snapshot
```

CI runs `apply.sh --env staging` on merge to main (workflow:
`.github/workflows/observability-apply-staging.yml`, CS-10932) and
`apply.sh --env production` on the production workflow
(CS-10936).

## Operator actions

Some dashboards carry buttons that POST to a realm-server operator endpoint —
reindex a realm, complete a stuck job, grant a permission, add credit. Each one
is a `volkovlabs-form-panel` button whose `customCode` does the `fetch`; there
are no plain GET links, and no secret travels in a querystring.

**Where they live.** An action goes on the dashboard whose data motivates it,
rather than in one central console: per-realm reindex on `realms.json`, full
reindex on `indexing.json`, job completion on `job-queue.json` /
`indexing.json` / `prerender-html.json`, credit on `users.json`, permission
grants on `realms.json` / `published-realms.json` / `users.json`. An operator
looking at the numbers that prompted the action finds the button already in
front of them.

**Auth.** Every call sends `Authorization: Bearer ${grafana_secret}`. That
variable is a hidden `constant` in each dashboard's `templating.list`, committed
as the literal `REPLACE_AT_APPLY_TIME` and swapped for the real value by
`scripts/apply.sh` at apply time from `GRAFANA_SECRET`. The realm-server URL
works the same way, committed as `__REALM_SERVER_URL__` and filled from
`REALM_SERVER_URL`. Both substitutions are guarded on the placeholder string, so
they no-op on any other constant that happens to share the name, and
`scripts/lint.sh` fails the build if a committed dashboard carries anything but
the placeholder — a real secret can't be committed by accident.

**Writing one.** Three mistakes in `customCode` fail silently, so copy a working
button rather than starting fresh:

- `await` only inside an `(async () => { ... })()` wrapper. Top-level `await`
  isn't allowed in the panel's evaluation context.
- Interpolate with `${var:doublequote}`, never bare `${var}`. A bare
  substitution isn't quoted and produces a syntax error at eval time.
- Attach `.catch(...)` to the IIFE. A rejection from inside the `catch` handler
  is otherwise unhandled and the click appears to do nothing.

Report outcomes through `context.grafana.notifySuccess` /
`notifyError` and call `context.grafana.refresh()` on success so the panel's own
query reflects the change. Guard destructive actions with a `window.confirm`
that returns early, and say in the dialog what the action does _not_ do — an
operator's wrong mental model is the failure mode a tooltip won't catch.

## Phase status

Phases 2 through 6 (build-out and cutover) landed by 2026-05-06.
Remaining work:

| Ticket   | Phase | Status      | Description                                              |
| -------- | ----- | ----------- | -------------------------------------------------------- |
| CS-10933 | 4     | not started | CI: post diff comment on PRs                             |
| CS-10942 | 7     | not started | Decommission AMG `boxel-dashboard/` TF (cardstack/infra) |

## Indexing progress (CS-10930)

**Owner dashboard: `indexing.json`**. The Indexing dashboard owns the
cluster-wide indexing-progress view — backlog stats, throughput / stocks
time-series, and the per-active-job "Active Indexing" table with
file-by-file progress bars. Drill-through "View activity feed" links
open `boxel-logs.json` panel id 11 (Indexing Activity Feed) prefiltered
by realm.

**Hybrid storage**:

- **Snapshot state** lives in Postgres `job_progress` (UNLOGGED,
  PK = `job_id`). Three counters and a timestamp; `IndexingEventSink`
  upserts on `indexing-started` and `indexing-finished`, and a
  per-sink 1 s flush coalesces `file-visited` events into one UPDATE
  per dirty job per tick. Lost on Postgres crash by design (UNLOGGED) —
  acceptable because indexing runs that crash get re-driven and the
  table repopulates.
- **Streaming feed** lives in Loki. Each event also emits a structured
  `[indexing-progress] event=… job=… realm=… …` stdout line through
  the existing FireLens pipe. The Indexing Activity Feed panel filters
  by `|= "[indexing-progress]" |= "${realm_url}"`.

**Tunable**: set `BOXEL_INDEXING_PROGRESS_LOG_EVERY=N` (default `1`) on
each realm-server task to log only every Nth `file-visited` event. The
DB write-through is unaffected — it's already coalesced to ≤1 UPDATE
per active job per second. `BOXEL_INDEXING_PROGRESS_LOG_EVERY=10` cuts
Loki ingest cost ~10× during heavy indexing while keeping ~1 line/sec/job
of activity-feed visibility. `started`/`finished` lines are always
emitted regardless.

Why not Prometheus: workers expose no `/metrics` endpoint today, and
adding the AMP scrape pipe (Alloy sidecar, IAM, AMP datasource) is
2–3 days of `cardstack/infra` work — out of scope for one panel.

## Vendored content

`grafanactl/resources/dashboards/boxel-status/synapse.json` is vendored from the upstream Synapse project (https://github.com/matrix-org/synapse, `contrib/grafana/`). We carry a copy because we run a Synapse server. When Synapse upgrades add new metrics worth dashboarding, re-pull from upstream and rebase any local edits. Treat as third-party code: don't modify locally without intending to own the diff.

## Known cleanups (deferred)

- **Decommission the AMG-era `boxel-dashboard/` Terraform** in `cardstack/infra` once a full release cycle has gone by on the new flow. Tracked as CS-10942. After it lands, `configs/boxel-grafana-data-sources/` (in cardstack/infra) becomes the sole owner of the per-env data the boxel CI workflow reads.
- **Drop the dual-ship to CloudWatch** once Loki has been load-bearing for a release cycle. Until then both backends receive identical lines through the FireLens config in `cardstack/infra:modules/aws/ecs/firelens/templates/extra.conf.tftpl`.
- **CODEOWNERS.** No file in the repo today — if the team wants observability-specific reviewer requirements, file a separate ticket.
- **Rotate the `grafana_secret`.** An earlier value was baked into Terraform and piped through CI logs, so treat that one as compromised until it has been rotated. Unverified as of this writing — if rotation has already happened, drop this item.

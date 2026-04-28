# @cardstack/observability

Self-host Grafana dashboards, alerts, and data sources as code, plus a local `docker-compose` stack (Grafana + Loki) for previewing changes before they hit staging.

## Project context

Part of the AMG → self-host Grafana migration:

- [Linear: Replace dashboard with our own grafana](https://linear.app/cardstack/project/replace-dashboard-with-our-own-grafana-1b7e3de21dbf)
- Self-host Grafana Terraform: `cardstack/infra:configs/grafana/`
- AMG Terraform (current production, being deprecated): `cardstack/infra:configs/boxel-dashboard/`

## Architecture: two trees, two delivery mechanisms

There are **two source-of-truth trees** in this package, because Grafana 12 manages different resource kinds through different APIs:

| Tree                   | Tool                  | Resource kinds                               | Apply mechanism                                  |
| ---------------------- | --------------------- | -------------------------------------------- | ------------------------------------------------ |
| `grafanactl/resources/` | `grafanactl resources push` | Dashboards, folders                       | API push (CI on merge)                            |
| `provisioning/`        | Grafana built-in file provisioning | Data sources, alert rules, contact points | Files mounted at `/etc/grafana/provisioning/`, read at startup |

**Why two trees?** `grafanactl` (Grafana Labs' official CLI replacing the archived Grizzly) only manages App Platform resources — `grafanactl resources list` shows dashboards, folders, playlists, snapshots, but **not data sources or alert rules**. Those still live behind the legacy HTTP API and are best managed via Grafana's built-in file provisioning, which natively supports `${ENV_VAR}` substitution at startup.

For staging and production, the `provisioning/` tree gets delivered to the ECS Grafana container (via image bake, S3-init, or EFS mount — TBD in a separate infra ticket). Container restart picks up changes; a Grafana admin API endpoint (`/api/admin/provisioning/datasources/reload`) can refresh without restart if needed.

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
alloy/
  config.alloy         # local log scraper config — discovers Docker containers
                       # and ships their stdout into Loki
loki/
  config.yaml          # local Loki config (single-node, filesystem, accepts
                       # historical Docker logs)
scripts/
  apply.sh             # ./scripts/apply.sh --env <local|staging|production>
  pull.sh              # ./scripts/pull.sh  --env <name> --path <dir>
  check.sh             # ./scripts/check.sh --env <name>  (connectivity smoke test)
  render-config.sh     # internal — renders grafanactl config.yaml per-invocation
  grafanactl-env.sh    # sourceable; exports GRAFANA_TOKEN from SSM for staging/prod
templates/
  env-vars.env.example
docker-compose.yml     # local Grafana 12.4.3 + Loki 3.4.4 + Alloy 1.10.0
```

## Local workflow

```sh
# One-time: install grafanactl
brew install --formula grafanactl

# Bring up local Grafana + Loki + Alloy (log scraper)
docker compose up -d
# Grafana: http://localhost:3001  (admin / admin)
# Loki:    http://localhost:3100
# Alloy:   http://localhost:12345  (target / pipeline debug UI)

# Verify connectivity
./scripts/check.sh --env local

# Apply (no-op until Phase 3 imports dashboards from AMG)
./scripts/apply.sh --env local
```

In Grafana, run a LogQL query like `{env="local"}` against the Loki data
source to see lines from any other container running on the host.

## Loki label schema

The label set is **load-bearing**: dashboards written in LogQL select on
these labels, so the local scraper, staging FireLens, and production
FireLens must all emit the same shape. Pick the schema once, here.

| Label     | Source (local)                              | Source (staging / production)             |
| --------- | ------------------------------------------- | ----------------------------------------- |
| `env`     | constant `local` (set in `alloy/config.alloy`) | constant `staging` / `production` (FireLens record_modifier) |
| `service` | Docker container name, leading `/` stripped | ECS task family, e.g. `realm-server`, `worker`, `synapse` |
| `realm`   | opt-in via Docker label `boxel.realm=<name>` | realm name from worker/realm-server task env |

The local scraper drops `grafana`, `loki`, and `alloy`'s own log streams
to keep `{env="local"}` queries clean and avoid a Grafana → Loki feedback
loop.

To tag a custom local container so dashboards pick it up by realm:

```sh
docker run --label boxel.realm=test_realm --name my-realm-worker ...
```

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

CI will run `apply.sh --env staging` on merge to main once Phase 4 (CS-10932) lands.

## Phase status

| Ticket    | Phase | Status      | Description                              |
| --------- | ----- | ----------- | ---------------------------------------- |
| CS-10914  | 2     | landed      | Package skeleton                         |
| CS-10912  | 2     | landed      | Local `docker-compose.yml` for Grafana   |
| CS-10913  | 2     | landed      | grafanactl `local`/`staging`/`prod` ctxs |
| CS-10918  | 2.5   | landed      | Loki container + data source             |
| CS-10916  | 2.5   | this PR     | Alloy log scraper for local              |
| CS-10922  | 3     | landed      | AMG export and reformat                  |
| CS-10932  | 4     | not started | CI: apply to staging on merge            |
| CS-10933  | 4     | not started | CI: post diff comment on PRs             |
| CS-10936  | 5     | not started | CI: apply to production                  |

## Vendored content

`grafanactl/resources/dashboards/boxel-status/synapse.json` is vendored from the upstream Synapse project (https://github.com/matrix-org/synapse, `contrib/grafana/`). We carry a copy because we run a Synapse server. When Synapse upgrades add new metrics worth dashboarding, re-pull from upstream and rebase any local edits. Treat as third-party code: don't modify locally without intending to own the diff.

## Known cleanups (deferred)

- **Staging/production Loki ECS deployment.** Currently no Loki running in staging or production. Staging/production Grafana provisioning expects `${LOKI_URL}` to be set on the ECS task; that's an infra ticket.
- **`provisioning/` delivery to staging/production ECS.** The provisioning files (data sources + alert rules) need to land on the ECS Grafana container — image bake, S3-init, or EFS mount. Decide and ship as a separate infra ticket.
- **Secret env-var wiring for data sources.** `provisioning/datasources/*.json` omits `secureJsonData` (passwords, API keys). The staging/production ECS Grafana task needs those env vars set from SSM (`GRAFANA_DB_PASSWORD` etc.) and the provisioning files updated to reference them via `${ENV_VAR}`.
- **CODEOWNERS.** No file in the repo today — if the team wants observability-specific reviewer requirements, file a separate ticket.

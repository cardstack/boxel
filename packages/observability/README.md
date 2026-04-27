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
    alerts/            # placeholder — alert rule groups go in provisioning/alerting/
provisioning/          # mounted into Grafana at /etc/grafana/provisioning/
  datasources/         # data sources (Loki, Postgres, CloudWatch, Prometheus)
  alerting/            # alert rule groups, contact points, notification policies
scripts/
  apply.sh             # ./scripts/apply.sh --env <local|staging|production>
  pull.sh              # ./scripts/pull.sh  --env <name> --path <dir>
  check.sh             # ./scripts/check.sh --env <name>  (connectivity smoke test)
  render-config.sh     # internal — renders grafanactl config.yaml per-invocation
  grafanactl-env.sh    # sourceable; exports GRAFANA_TOKEN from SSM for staging/prod
templates/
  env-vars.env.example
docker-compose.yml     # local Grafana 12.4.3 + Loki 3.4.4 (Alloy commented out)
```

## Local workflow

```sh
# One-time: install grafanactl
brew install --formula grafanactl

# Bring up local Grafana + Loki
docker compose up -d
# Grafana: http://localhost:3001  (admin / admin)
# Loki:    http://localhost:3100

# Verify connectivity
./scripts/check.sh --env local

# Apply (no-op until Phase 3 imports dashboards from AMG)
./scripts/apply.sh --env local
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
| CS-10918  | 2.5   | this PR     | Loki container + data source             |
| CS-10922  | 3     | not started | AMG export and reformat                  |
| CS-10932  | 4     | not started | CI: apply to staging on merge            |
| CS-10933  | 4     | not started | CI: post diff comment on PRs             |
| CS-10936  | 5     | not started | CI: apply to production                  |

## Known cleanups (deferred)

- **Alloy log scraping config.** docker-compose has Alloy commented out; un-comment + add `alloy/config.alloy` to ship logs into local Loki. Separate ticket — not strictly required for Loki data source to be useful.
- **Staging/production Loki ECS deployment.** Currently no Loki running in staging or production. Staging/production Grafana provisioning expects `${LOKI_URL}` to be set on the ECS task; that's an infra ticket.
- **Alert rule provisioning.** `provisioning/alerting/` is empty. Phase 3 (CS-10922) imports alert rules from AMG.
- **CODEOWNERS.** No file in the repo today — if the team wants observability-specific reviewer requirements, file a separate ticket.

# @cardstack/observability

Self-host Grafana dashboards as code. Holds the [grafanactl](https://grafana.com/docs/grafana/latest/cli/grafanactl/) resource manifests (dashboards, data sources, folders, alerts) and a local Grafana `docker-compose` for previewing changes before they hit staging.

## Project context

This package is part of the AMG → self-host Grafana migration:

- [Linear: Replace dashboard with our own grafana](https://linear.app/cardstack/project/replace-dashboard-with-our-own-grafana-1b7e3de21dbf)
- Self-host Grafana Terraform: `cardstack/infra:configs/grafana/`
- AMG Terraform (current production, being deprecated): `cardstack/infra:configs/boxel-dashboard/`

## Layout

```
grafanactl/
  config.yaml          # context per env (local / staging / production)
  resources/
    folders/           # Grafana folder definitions
    datasources/       # Postgres / Prometheus / CloudWatch / Loki
    dashboards/        # dashboard JSON, organized by folder
    alerts/            # alert rule groups
scripts/               # apply.sh, pull.sh, diff.sh, tail-logs.sh (added in later tickets)
templates/             # env-vars.env.example
docker-compose.yml     # local Grafana for previewing changes
```

## Workflow (sketch — fully wired in later phases)

```sh
# Install grafanactl
brew install --formula grafanactl

# Preview a change against the local Grafana
docker compose up -d grafana
./scripts/apply.sh --env local

# Preview the diff against staging (Path B from CS-10933:
# pull-to-tempdir + git-diff, since grafanactl has no native diff)
./scripts/diff.sh --env staging

# Apply to staging (CI does this on merge to main)
./scripts/apply.sh --env staging
```

This README expands as the migration progresses (Phase 2.5 Loki integration, Phase 3 AMG export, Phase 4 CI wiring).

## Phase status

| Ticket    | Phase | Status     | Description                              |
| --------- | ----- | ---------- | ---------------------------------------- |
| CS-10914  | 2     | this PR    | Package skeleton                         |
| CS-10912  | 2     | not started | Local `docker-compose.yml` for Grafana   |
| CS-10913  | 2     | not started | grafanactl `local`/`staging`/`prod` ctxs |
| CS-10918  | 2.5   | not started | Loki data source                         |
| CS-10922  | 3     | not started | AMG export and reformat                  |
| CS-10932  | 4     | not started | CI: apply to staging on merge            |
| CS-10933  | 4     | not started | CI: post diff comment on PRs             |
| CS-10936  | 5     | not started | CI: apply to production                  |

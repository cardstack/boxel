#!/usr/bin/env bash
# Apply grafanactl resource manifests to a Grafana environment.
#
# Usage:
#   ./scripts/apply.sh [--env local|staging|production] [grafanactl push flags...]
#
# Examples:
#   ./scripts/apply.sh                          # local (default)
#   ./scripts/apply.sh --env staging --dry-run  # preview against staging
#   ./scripts/apply.sh --env staging            # apply to staging (CI does this on merge)
#
# Prereqs:
#   - grafanactl installed (brew install --formula grafanactl)
#   - For local: docker compose up -d grafana
#   - For staging/production: AWS credentials with ssm:GetParameter
set -eo pipefail

usage_error() { echo "error: $1" >&2; exit 2; }

env_name=local
forwarded_args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      [[ $# -ge 2 && "$2" != --* ]] || usage_error "missing value for --env"
      env_name="$2"
      shift 2
      ;;
    --env=*)
      env_name="${1#--env=}"
      [[ -n "$env_name" ]] || usage_error "missing value for --env"
      shift
      ;;
    *)
      # Anything else is forwarded to grafanactl push (e.g., --dry-run).
      forwarded_args+=("$1")
      shift
      ;;
  esac
done

cd "$(dirname "$0")/.."

# shellcheck source=./grafanactl-env.sh
source ./scripts/grafanactl-env.sh "$env_name"

# `jq` is needed for the dashboard render step below in every env (including
# local), so always check it. The other dependencies are only needed for the
# hosted-env data-source push; check them inside the env-specific block.
command -v jq >/dev/null \
  || { echo "error: missing dependency: jq" >&2; exit 1; }

# Pre-flight prereqs for hosted envs BEFORE grafanactl pushes anything.
# Otherwise a missing env var or absent yq would surface only after
# dashboards/folders had already been re-pushed, leaving a partial apply.
if [[ "$env_name" != "local" ]]; then
  for cmd in yq curl envsubst; do
    command -v "$cmd" >/dev/null \
      || { echo "error: missing dependency: ${cmd}" >&2; exit 1; }
  done
  required_env_vars=(
    GRAFANA_TOKEN
    # Loki — CS-10968
    LOKI_URL
    # Boxel-db postgres + synapse-prometheus — CS-10978
    BOXEL_DB_HOST
    BOXEL_DB_NAME
    BOXEL_DB_USER
    BOXEL_DB_PASSWORD
    SYNAPSE_PROMETHEUS_URL
    # Per-env realm-server base URL substituted into dashboards' realm_server
    # constant template variable — CS-10923
    REALM_SERVER_URL
    # Realm-server shared secret substituted into dashboards' grafana_secret
    # constant template variable — CS-10929. Used as `Authorization: Bearer
    # ${grafana_secret}` by the operator-action button panels.
    GRAFANA_SECRET
    # CloudWatch log group + owning AWS account substituted into the
    # worker-status-group alert rules at push time — CS-11107. The same
    # provisioning file is shipped to both envs, so the log-group name
    # and account-id have to come from outside the file, otherwise prod
    # ends up querying staging's log group and every evaluation 404s.
    WORKER_LOG_GROUP_NAME
    WORKER_LOG_GROUP_ACCOUNT_ID
  )
  for v in "${required_env_vars[@]}"; do
    [[ -n "${!v:-}" ]] \
      || { echo "error: ${v} not set; CI fetches it from SSM in observability-apply-${env_name}.yml — for a local hosted run, export it manually first (see apply-datasources.sh header for the SSM path)" >&2; exit 1; }
  done
fi

cfg="$(./scripts/render-config.sh "$env_name")"

# Render dashboards: copy the committed grafanactl/resources/ tree to a
# tempdir and substitute env-specific values into each dashboard's
# `templating.list[].query` for matching constant variables. Currently
# substitutes:
#   __REALM_SERVER_URL__  → REALM_SERVER_URL  (CS-10923)
#   REPLACE_AT_APPLY_TIME → GRAFANA_SECRET    (CS-10929; used as
#                                              `Authorization: Bearer
#                                              ${grafana_secret}` in
#                                              operator-action button panels)
#   __ENV__               → env_name          (local|staging|production;
#                                              used in CloudWatch
#                                              dimension values like
#                                              "boxel-realm-server-${env}")
# Local mode uses hardcoded defaults so devs don't need any extra setup.
rendered="$(mktemp -d -t grafanactl-render.XXXXXX)"
trap 'rm -f "$cfg"; rm -rf "$rendered"' EXIT
cp -R ./grafanactl/resources/. "$rendered/"

case "$env_name" in
  local)
    realm_server_url="${REALM_SERVER_URL:-https://localhost:4201/}"
    # Matches the dev default in packages/software-factory/src/harness/shared.ts
    # and the matrix test harness, so local Grafana buttons authenticate
    # against a freshly started realm-server with no extra env config.
    # Set in two steps because the dev default contains an apostrophe — fragile
    # inside `${VAR:-default}` when wrapped in double quotes.
    if [[ -n "${GRAFANA_SECRET:-}" ]]; then
      grafana_secret="$GRAFANA_SECRET"
    else
      grafana_secret="shhh! it's a secret"
    fi
    ;;
  *)
    realm_server_url="$REALM_SERVER_URL"
    grafana_secret="$GRAFANA_SECRET"
    ;;
esac

# `find -print0` + a NUL-delimited read loop rather than a `**/*.json` glob —
# macOS's default bash 3.2 doesn't support `shopt -s globstar` and `set -eo`
# would abort apply.sh before any push. This pattern is portable across bash
# 3.2 / 4.x / 5.x and zsh.
while IFS= read -r -d '' f; do
  # `set -e` aborts on a non-zero exit, but only for "simple commands" — a
  # `jq ... > out && mv ...` chain swallows jq's failure inside the &&,
  # leaving the script to continue with an unrendered file. Run as two
  # separate statements so a jq error fails the script.
  #
  # Both substitutions are GUARDED by the placeholder string in `.query` so
  # this is a no-op for any other constant template variable that happens to
  # share a name. Lint enforces grafana_secret == REPLACE_AT_APPLY_TIME on
  # committed JSON, so the guard never spuriously skips a real secret.
  jq --arg url "$realm_server_url" --arg secret "$grafana_secret" --arg envname "$env_name" '
    walk(
      if type == "object"
         and .name? == "realm_server"
         and .type? == "constant"
         and .query? == "__REALM_SERVER_URL__"
      then
        .query = $url
        | (if .current then .current.value = $url | .current.text = $url else . end)
      elif type == "object"
         and .name? == "grafana_secret"
         and .type? == "constant"
         and .query? == "REPLACE_AT_APPLY_TIME"
      then
        .query = $secret
        | (if .current then .current.value = $secret | .current.text = $secret else . end)
      elif type == "object"
         and .name? == "env"
         and .type? == "constant"
         and .query? == "__ENV__"
      then
        .query = $envname
        | (if .current then .current.value = $envname | .current.text = $envname else . end)
      else . end
    )
  ' "$f" > "$f.tmp"
  mv "$f.tmp" "$f"

  # Local-only: swap CloudWatch panels for a markdown placeholder. The
  # committed JSON keeps real CloudWatch queries (so staging/production
  # apply pushes them unchanged); locally there are no AWS creds, so the
  # panels would otherwise show "No data" + a query-error triangle that's
  # indistinguishable from a real broken panel.
  #
  # Match by gridPos+datasource.type so we only rewrite top-level panels
  # (panel targets also carry a `datasource.type: cloudwatch` field but
  # don't have gridPos). Preserve id, title, and gridPos so layout is
  # unchanged; replace everything else with a `text` markdown panel.
  if [[ "$env_name" == "local" ]]; then
    jq '
      walk(
        if type == "object"
           and (.datasource? | type == "object")
           and .datasource.type? == "cloudwatch"
           and (.gridPos? | type == "object")
        then
          {
            id: .id,
            type: "text",
            title: .title,
            gridPos: .gridPos,
            options: {
              code: { language: "plaintext", showLineNumbers: false, showMiniMap: false },
              content: "**☁️ AWS CloudWatch — staging/production only**\n\nThe `boxel-cloudwatch` datasource has no AWS credentials in local dev. ECS resource utilisation (CPU / Memory / Tasks) renders correctly when this dashboard is applied to a hosted Grafana.",
              mode: "markdown"
            },
            pluginVersion: "12.4.3",
            transparent: false
          }
        else . end
      )
    ' "$f" > "$f.tmp"
    mv "$f.tmp" "$f"
  fi
done < <(find "$rendered/dashboards" -type f -name '*.json' -print0)

grafanactl \
  --config "$cfg" \
  --context "$env_name" \
  resources push \
  --path "$rendered" \
  "${forwarded_args[@]}"

# Data sources — grafanactl doesn't manage them, so push via HTTP API.
# Local skips this (docker-compose handles file provisioning).
./scripts/apply-datasources.sh --env "$env_name"

# Alert rule groups — also outside grafanactl's scope. Run after the
# datasource push so any datasource UIDs the rules reference are
# guaranteed to exist before the rules land. Local skips this (the
# docker-compose file mount provisions alerts at container startup).
./scripts/apply-alerting.sh --env "$env_name"

# Org-wide default home dashboard — Grafana has no file-provisioning shape
# for org preferences, so PATCH /api/org/preferences directly. Runs in
# every env (including local — preferences aren't in the file-provisioning
# tree). Must run AFTER the dashboards push above so the referenced UID
# exists when Grafana validates the preference.
./scripts/apply-home-dashboard.sh --env "$env_name"

#!/usr/bin/env bash
# Tail Loki logs from a laptop. Wraps the same /loki/api/v1/query_range
# call that `logcli` makes, with auth + URL plumbing pre-baked from SSM.
#
# Usage:
#   ./scripts/tail-logs.sh --env local|staging|production
#                          --service realm-server|worker|prerender|prerender-manager|synapse
#                         [--realm <name>]
#                         [--worker-id <id>]
#                         [--filter <substring>]      # LogQL line-filter (|=)
#                         [--regex <pattern>]         # LogQL line-regex (|~)
#                         [--since <duration>]        # 15m | 1h | 30s | 2d (default 15m)
#                         [--limit <n>]               # batch size per poll (default 200)
#                         [--no-follow]               # one-shot, exit after the first batch
#                         [--json]                    # raw Loki response per batch
#                         [--confirm]                 # required for --env production
#
# Auth and URL come from SSM:
#   /<env>/loki/auth_token  — bearer token
#   /<env>/loki/public_url  — e.g. https://dashboard-staging.stack.cards/loki
# Local mode hits http://localhost:3100 without auth.
#
# Examples:
#   ./scripts/tail-logs.sh --env local --service realm-server
#   ./scripts/tail-logs.sh --env staging --service realm-server --since 1h --regex 'error|exception'
#   ./scripts/tail-logs.sh --env staging --service worker --worker-id abc123 --filter 'job_id=42'
#   ./scripts/tail-logs.sh --env production --service synapse --since 30m --confirm
set -eo pipefail

POLL_INTERVAL_SECONDS=5

usage_error() { printf 'error: %s\n' "$1" >&2; exit 2; }
fail() { printf 'error: %s\n' "$1" >&2; exit 1; }

# Defaults
env_name=""
service=""
realm=""
worker_id=""
line_filter=""
line_regex=""
since="15m"
limit=200
follow="yes"
json_out="no"
confirm_prod="no"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)        env_name="$2"; shift 2;;
    --service)    service="$2"; shift 2;;
    --realm)      realm="$2"; shift 2;;
    --worker-id)  worker_id="$2"; shift 2;;
    --filter)     line_filter="$2"; shift 2;;
    --regex)      line_regex="$2"; shift 2;;
    --since)      since="$2"; shift 2;;
    --limit)      limit="$2"; shift 2;;
    --follow)     follow="yes"; shift;;
    --no-follow)  follow="no"; shift;;
    --json)       json_out="yes"; shift;;
    --confirm)    confirm_prod="yes"; shift;;
    -h | --help)
      sed -n '/^# Usage:/,/^set -/{ /^set -/d; s/^# \?//; p; }' "$0"
      exit 0;;
    *) usage_error "unknown option: $1";;
  esac
done

[[ -n "$env_name" ]] || usage_error "missing --env"
[[ "$env_name" == "local" || "$env_name" == "staging" || "$env_name" == "production" ]] \
  || usage_error "--env must be local, staging, or production (got: $env_name)"
[[ -n "$service" ]] || usage_error "missing --service"
[[ -z "$line_filter" || -z "$line_regex" ]] || usage_error "use --filter OR --regex, not both"

if [[ "$env_name" == "production" && "$confirm_prod" != "yes" ]]; then
  fail "querying production requires --confirm (production logs flow through the same Grafana ALB everyone uses)"
fi

# Convert "15m" / "1h" / "30s" / "2d" → seconds.
parse_duration_seconds() {
  local d="$1"
  [[ "$d" =~ ^([0-9]+)([smhd])$ ]] || fail "invalid duration: $d (expected e.g. 15m, 1h, 30s, 2d)"
  local n="${BASH_REMATCH[1]}"
  case "${BASH_REMATCH[2]}" in
    s) printf '%d\n' "$n" ;;
    m) printf '%d\n' "$((n * 60))" ;;
    h) printf '%d\n' "$((n * 3600))" ;;
    d) printf '%d\n' "$((n * 86400))" ;;
  esac
}

since_seconds="$(parse_duration_seconds "$since")"

# Resolve auth + URL. The base URL always has Loki's `/loki` path segment
# baked in: locally that's Loki's native API namespace; for staging /
# production it's the ALB rule prefix (the hosted API URLs happen to align
# because the ALB rule prefix and Loki's native namespace are both `/loki`).
auth_header=()
case "$env_name" in
  local)
    base="http://localhost:3100/loki"
    ;;
  staging | production)
    token="$(aws ssm get-parameter \
      --name "/${env_name}/loki/auth_token" \
      --with-decryption --query 'Parameter.Value' --output text 2>/dev/null)" \
      || fail "couldn't fetch /${env_name}/loki/auth_token from SSM (is AWS auth active for the ${env_name} account?)"
    base="$(aws ssm get-parameter \
      --name "/${env_name}/loki/public_url" \
      --query 'Parameter.Value' --output text 2>/dev/null)" \
      || fail "couldn't fetch /${env_name}/loki/public_url from SSM"
    auth_header=(-H "Authorization: Bearer ${token}")
    ;;
esac

# Build the LogQL selector. `service` is required, the rest are optional.
selector="{env=\"${env_name}\", service=\"${service}\""
[[ -n "$realm"     ]] && selector="${selector}, realm=\"${realm}\""
[[ -n "$worker_id" ]] && selector="${selector}, worker_id=\"${worker_id}\""
selector="${selector}}"

query="$selector"
if [[ -n "$line_filter" ]]; then
  query="${query} |= \"${line_filter}\""
elif [[ -n "$line_regex" ]]; then
  query="${query} |~ \"${line_regex}\""
fi

# Format a Loki response into "<rfc3339> <labels> <line>" per row.
format_lines() {
  if [[ "$json_out" == "yes" ]]; then
    jq .
    return
  fi
  jq -r '
    .data.result[]?
    | (.stream | to_entries | map("\(.key)=\(.value)") | join(",")) as $labels
    | .values[]?
    | ((.[0] | tonumber) / 1e9 | todate) + "  [" + $labels + "]  " + .[1]
  '
}

# Single query_range fetch over [start_ns, end_ns). Validates that the
# response is JSON and `status: success` before handing it to the formatter
# — Loki's auth / 5xx error pages aren't JSON, and an unguarded jq pipe
# emits cryptic parse errors that hide the real problem.
fetch_range() {
  local start_ns="$1" end_ns="$2"
  local body http_status
  body="$(curl -sS -w '\n__HTTP_STATUS__%{http_code}\n' "${auth_header[@]}" -G \
    --data-urlencode "query=${query}" \
    --data-urlencode "start=${start_ns}" \
    --data-urlencode "end=${end_ns}" \
    --data-urlencode "limit=${limit}" \
    --data-urlencode "direction=forward" \
    "${base}/api/v1/query_range")"
  http_status="$(printf '%s\n' "$body" | sed -n 's/^__HTTP_STATUS__//p' | tail -1)"
  body="$(printf '%s\n' "$body" | sed '/^__HTTP_STATUS__/d')"

  if [[ "$http_status" != 2?? ]]; then
    printf 'error: Loki query returned HTTP %s\n%s\n' "$http_status" "$body" >&2
    return 1
  fi
  if ! printf '%s' "$body" | jq -e '.status == "success"' >/dev/null 2>&1; then
    printf 'error: Loki response not in expected shape\n%s\n' "$body" >&2
    return 1
  fi
  printf '%s\n' "$body"
}

now_ns="$(date -u +%s)000000000"
since_ns=$(( now_ns - since_seconds * 1000000000 ))

# Header so the user knows what they're tailing.
{
  printf '# tail-logs.sh\n'
  printf '#   env:      %s\n' "$env_name"
  printf '#   query:    %s\n' "$query"
  printf '#   since:    %s\n' "$since"
  printf '#   limit:    %s per batch\n' "$limit"
  printf '#   follow:   %s\n' "$follow"
  printf '#   endpoint: %s/api/v1/query_range\n' "$base"
  printf '#\n'
} >&2

fetch_range "$since_ns" "$now_ns" | format_lines

if [[ "$follow" != "yes" ]]; then
  exit 0
fi

# Live tail: poll the next [last_end, now] window every POLL_INTERVAL_SECONDS.
last_end_ns="$now_ns"
while sleep "$POLL_INTERVAL_SECONDS"; do
  now_ns="$(date -u +%s)000000000"
  fetch_range "$last_end_ns" "$now_ns" | format_lines
  last_end_ns="$now_ns"
done

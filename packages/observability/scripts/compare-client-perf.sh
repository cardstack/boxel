#!/usr/bin/env bash
# Compare the host's client-performance telemetry across two time windows, so
# "did that change help?" has a repeatable answer instead of a squint at a
# graph.
#
# Usage:
#   ./scripts/compare-client-perf.sh --env staging|production \
#                                    --before <ISO8601>..<ISO8601> \
#                                    --after  <ISO8601>..<ISO8601> \
#                                   [--user <matrix_user_id>] \
#                                   [--before-version <app_version>] \
#                                   [--after-version <app_version>] \
#                                   [--json]
#
# Browsers do not all reload at once, so a deploy does not partition users by
# time — production routinely serves three builds at once, and a time-based
# before/after mixes users who picked the change up with users who did not.
# `--before-version` / `--after-version` pin each side to one build instead,
# which lets both windows be the SAME window: same hours, same population,
# same everything except the code. That is the stronger comparison, and it is
# the one to reach for once enough traffic has moved onto the new build.
# `app_version` is the short commit SHA the host reports; read the mix with:
#
#   sum by (app_version) (count_over_time(<base> [24h]))
#
# Times are UTC ISO8601 (2026-09-16T13:00:00Z). Both windows should cover the
# same hours on comparable days: this telemetry comes from real users, so a
# school-hours window and an overnight window differ for reasons that have
# nothing to do with the deploy between them.
#
# Auth and URL come from SSM, fetched per call and never written down:
#   /<env>/loki/auth_token   — bearer token (held in memory, never on disk)
#   /<env>/loki/public_url   — e.g. https://dashboard.boxel.ai/loki
#
# Why the numbers are rates, not counts. Every absolute count here scales with
# how many people happened to be using the app, which is not what a deploy
# changes. So each one is divided by the number of distinct sessions in its own
# window, and what gets compared is per-session work. A window with twice the
# users and twice the requests is unchanged by that measure, correctly.
set -eo pipefail

ENV_NAME=""; BEFORE=""; AFTER=""; USER_FILTER=""; AS_JSON=""
BEFORE_VERSION=""; AFTER_VERSION=""

fail() { echo "error: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENV_NAME="$2"; shift 2 ;;
    --before) BEFORE="$2"; shift 2 ;;
    --after) AFTER="$2"; shift 2 ;;
    --user) USER_FILTER="$2"; shift 2 ;;
    --before-version) BEFORE_VERSION="$2"; shift 2 ;;
    --after-version) AFTER_VERSION="$2"; shift 2 ;;
    --json) AS_JSON=1; shift ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[ -n "$ENV_NAME" ] || fail "--env is required (staging|production)"
[ -n "$BEFORE" ] || fail "--before is required (<ISO>..<ISO>)"
[ -n "$AFTER" ] || fail "--after is required (<ISO>..<ISO>)"
case "$ENV_NAME" in staging|production) ;; *) fail "--env must be staging or production" ;; esac

# GNU date and BSD date disagree about parsing; python is present either way
# and is what does the arithmetic below regardless.
to_epoch() { python3 -c "import datetime,sys;print(int(datetime.datetime.fromisoformat(sys.argv[1].replace('Z','+00:00')).timestamp()))" "$1"; }

split_window() {
  case "$1" in *..*) ;; *) fail "window must be <ISO>..<ISO>, got: $1" ;; esac
  echo "$(to_epoch "${1%%..*}") $(to_epoch "${1##*..}")"
}

read -r BEFORE_START BEFORE_END <<<"$(split_window "$BEFORE")"
read -r AFTER_START AFTER_END <<<"$(split_window "$AFTER")"
[ "$BEFORE_END" -gt "$BEFORE_START" ] || fail "--before window ends before it starts"
[ "$AFTER_END" -gt "$AFTER_START" ] || fail "--after window ends before it starts"

BEFORE_SECS=$((BEFORE_END - BEFORE_START))
AFTER_SECS=$((AFTER_END - AFTER_START))

LOKI_URL="$(aws ssm get-parameter --name "/${ENV_NAME}/loki/public_url" \
  --query 'Parameter.Value' --output text 2>/dev/null)" \
  || fail "couldn't read /${ENV_NAME}/loki/public_url (is AWS auth active for ${ENV_NAME}?)"

# Held in a shell variable for the life of this process and never written to
# disk, the same handling `tail-logs.sh` gives it. Re-fetching per query would
# cost two dozen extra SSM round trips for no gain in secrecy.
LOKI_TOKEN="$(aws ssm get-parameter --name "/${ENV_NAME}/loki/auth_token" \
  --with-decryption --query 'Parameter.Value' --output text 2>/dev/null)" \
  || fail "couldn't read /${ENV_NAME}/loki/auth_token (is AWS auth active for ${ENV_NAME}?)"

# The stream selector plus the two-stage unwrap: alloy ships the container's
# stdout as JSON with the event in a `log` field, so the event's own fields
# only exist after a second `| json`.
BASE="{service=\"realm-server\", env=\"${ENV_NAME}\"} |= \"boxel:client-perf\" | json | line_format \"{{.log}}\" | json"
[ -n "$USER_FILTER" ] && BASE="${BASE} | matrix_user_id=\"${USER_FILTER}\""

# One instant query at the end of a window, with the window itself as the
# range. `count_over_time` over the whole span is what makes the two windows
# comparable when they differ in length.
loki_instant() {
  local query="$1" at="$2"
  curl -sS -G "${LOKI_URL}/api/v1/query" \
    -H "Authorization: Bearer ${LOKI_TOKEN}" \
    --data-urlencode "query=${query}" \
    --data-urlencode "time=${at}"
}

# `| json` promotes every event field to a label, so an ungrouped range
# aggregation over unwrapped values asks for one series per distinct
# card_id/session_id/ts and trips Loki's 500-series cap. The quantiles below
# carry `by ()` to collapse that back to the one series being asked for.
# Each metric is (key, label, unit, logql-template). `RANGE` is substituted
# with the window length so one definition serves both sides.
read -r -d '' METRICS <<'EOM' || true
sessions|active sessions|count|count(sum by (session_id) (count_over_time(BASE [RANGE])))
reloads_per_event|reloads triggered per index event|reloads|sum(sum_over_time(BASE | event_type="realm-event" | unwrap reloads_triggered [RANGE])) / sum(count_over_time(BASE | event_type="realm-event" [RANGE]))
reloads_external|  ... on someone else's write|reloads|sum(sum_over_time(BASE | event_type="realm-event" | own_write="false" | unwrap reloads_triggered [RANGE])) / sum(count_over_time(BASE | event_type="realm-event" | own_write="false" [RANGE]))
realm_events|index events processed per session|events|sum(count_over_time(BASE | event_type="realm-event" [RANGE])) / count(sum by (session_id) (count_over_time(BASE [RANGE])))
requests|server requests per session|requests|sum(count_over_time(BASE | event_type="server-request" [RANGE])) / count(sum by (session_id) (count_over_time(BASE [RANGE])))
card_loads|card loads per session|loads|sum(count_over_time(BASE | event_type="card-load" [RANGE])) / count(sum by (session_id) (count_over_time(BASE [RANGE])))
settle_p50|card settle time p50|ms|quantile_over_time(0.5, BASE | event_type="card-load" | unwrap settle_ms [RANGE]) by ()
settle_p90|card settle time p90|ms|quantile_over_time(0.9, BASE | event_type="card-load" | unwrap settle_ms [RANGE]) by ()
deserialize_p50|deserialize p50|ms|quantile_over_time(0.5, BASE | event_type="deserialize" | unwrap duration_ms [RANGE]) by ()
doc_bytes_p90|response bytes deserialized p90|bytes|quantile_over_time(0.9, BASE | event_type="deserialize" | unwrap doc_bytes [RANGE]) by ()
stuck_loads|card loads stuck at the 30s ceiling|%|100 * sum(count_over_time(BASE | event_type="card-load" | settle_ms >= 29500 | settle_ms <= 30500 [RANGE])) / sum(count_over_time(BASE | event_type="card-load" [RANGE]))
wedges|main-thread freezes per session|wedges|sum(count_over_time(BASE | event_type="wedge" [RANGE])) / count(sum by (session_id) (count_over_time(BASE [RANGE])))
errors|client errors per session|errors|sum(count_over_time(BASE | event_type="client-error" [RANGE])) / count(sum by (session_id) (count_over_time(BASE [RANGE])))
EOM

scalar_of() {
  python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(''); raise SystemExit
if d.get('status')!='success': print(''); raise SystemExit
r=d.get('data',{}).get('result') or []
print(r[0]['value'][1] if r else '')
"
}

RESULTS=""
while IFS='|' read -r key label unit template; do
  [ -n "$key" ] || continue
  for side in before after; do
    if [ "$side" = before ]; then at="$BEFORE_END"; secs="$BEFORE_SECS"; else at="$AFTER_END"; secs="$AFTER_SECS"; fi
    side_base="$BASE"
    if [ "$side" = before ] && [ -n "$BEFORE_VERSION" ]; then
      side_base="${side_base} | app_version=\"${BEFORE_VERSION}\""
    elif [ "$side" = after ] && [ -n "$AFTER_VERSION" ]; then
      side_base="${side_base} | app_version=\"${AFTER_VERSION}\""
    fi
    q="${template//BASE/$side_base}"; q="${q//RANGE/${secs}s}"
    val="$(loki_instant "$q" "$at" | scalar_of)"
    RESULTS="${RESULTS}${key}|${label}|${unit}|${side}|${val}"$'\n'
  done
done <<<"$METRICS"

printf '%s' "$RESULTS" | python3 -c "
import sys, json, collections
rows = collections.OrderedDict()
meta = {}
for line in sys.stdin.read().splitlines():
    if not line.strip(): continue
    key, label, unit, side, val = line.split('|', 4)
    meta[key] = (label, unit)
    rows.setdefault(key, {})[side] = None if val == '' else float(val)

as_json = ${AS_JSON:-0}
if as_json:
    print(json.dumps({k: {'label': meta[k][0], 'unit': meta[k][1], **v} for k, v in rows.items()}, indent=2))
    raise SystemExit

def fmt(v, unit):
    if v is None: return '     —'
    if unit == 'bytes': return f'{v/1024:>7.0f}K'
    if unit == '%': return f'{v:>7.1f}%'
    if unit == 'ms': return f'{v:>8.0f}'
    if v >= 100: return f'{v:>8.0f}'
    return f'{v:>8.2f}'

print()
print(f\"  {'metric':<38} {'before':>9} {'after':>9} {'change':>10}\")
print('  ' + '─' * 68)
for key, v in rows.items():
    label, unit = meta[key]
    b, a = v.get('before'), v.get('after')
    if b is None or a is None or b == 0:
        change = '       n/a'
    else:
        pct = (a - b) / b * 100
        change = f'{pct:+9.1f}%'
    print(f'  {label:<38} {fmt(b, unit)} {fmt(a, unit)} {change}')
print()
print('  A metric reading — means no events of that type in the window; a rate')
print('  over zero sessions reads n/a. Neither is a zero.')
print()
"

#!/usr/bin/env bash
#
# claude-db.sh — run a read-only query against the staging/prod boxel
# database, hiding the SSM port-forward dance.
#
# The boxel RDS instances are private to the VPC, so every query has to go
# through an SSM tunnel opened via the realm-server ECS task. Done by hand
# that is six commands with three ids threaded between them, and the shape of
# those commands matters as much as their content: an agent driving them
# assembles credentials across several steps, which is exactly where a secret
# ends up somewhere it shouldn't. This script is the single entry point, so
# the whole flow can be allowed once and is safe by construction:
#
#   * The password is read from SSM into a shell variable and handed to psql
#     as PGPASSWORD on the invocation itself. It is never written to disk —
#     no ~/.pgpass, no temp file — and never echoed.
#   * The connection is always as ${CLAUDE_DB_USER} (`claude_readonly_user`),
#     the account whose grants are SELECT-only. The script verifies that it
#     actually connected as that user and that the user is in `readonly_role`
#     before it runs anything of yours, and aborts if either is false.
#   * Statements are checked to be read-only before they are sent. The DB
#     grants and the IAM policy already block writes; this is the third layer,
#     and it is what makes the script safe to allow wholesale.
#   * The tunnel is torn down on every exit path, including interrupts.
#
# Usage:
#   scripts/claude-db.sh staging -c "SELECT count(*) FROM boxel_index"
#   scripts/claude-db.sh prod    -f query.sql
#   scripts/claude-db.sh staging -c "SELECT 1" -- --csv
#
# Anything after `--` is passed through to psql verbatim (e.g. --csv, -x).
# Default output is unaligned and tuple-only, which is the easiest form to
# read back programmatically; pass `-- -P format=aligned` for a table.
#
# Requires a current session: `mise run claude-aws <env> <MFA_TOKEN>`.

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: claude-db.sh <staging|prod> (-c "SQL" | -f FILE) [-- psql args...]

  staging|prod   which deployed environment to query
  -c SQL         statement to run
  -f FILE        file of statements to run
  --             everything after this is passed to psql verbatim

Requires a current AWS session for the target environment:
  mise run claude-aws <staging|prod> <MFA_TOKEN>
EOF
  exit 2
}

die() {
  echo "claude-db: $*" >&2
  exit 1
}

[[ $# -ge 1 ]] || usage
ENV_NAME="$1"
shift

case "$ENV_NAME" in
staging)
  PROFILE="claude-staging"
  CLUSTER="staging"
  SERVICE="boxel-realm-server-staging"
  SSM_PREFIX="/staging/boxel"
  ;;
prod | production)
  ENV_NAME="prod"
  PROFILE="claude-prod"
  CLUSTER="production"
  SERVICE="boxel-realm-server-production"
  SSM_PREFIX="/production/boxel"
  ;;
*)
  usage
  ;;
esac

SQL=""
SQL_FILE=""
PSQL_PASSTHROUGH=()
while [[ $# -gt 0 ]]; do
  case "$1" in
  -c)
    [[ $# -ge 2 ]] || usage
    SQL="$2"
    shift 2
    ;;
  -f)
    [[ $# -ge 2 ]] || usage
    SQL_FILE="$2"
    shift 2
    ;;
  --)
    shift
    PSQL_PASSTHROUGH=("$@")
    break
    ;;
  *)
    usage
    ;;
  esac
done

[[ -n "$SQL" || -n "$SQL_FILE" ]] || usage
[[ -z "$SQL" || -z "$SQL_FILE" ]] || die "pass -c or -f, not both"
if [[ -n "$SQL_FILE" ]]; then
  [[ -r "$SQL_FILE" ]] || die "cannot read $SQL_FILE"
  SQL="$(cat "$SQL_FILE")"
fi

# ── read-only gate ────────────────────────────────────────────────────────
# Operator data fixes go through migrations and code paths, never an
# interactive session — so this refuses to *send* a mutation rather than
# relying on the server to reject one. The check is deliberately blunt: it
# scans the whole text for a forbidden keyword in statement position, and a
# false positive costs a rephrase while a false negative costs an incident.
assert_read_only() {
  local text="$1"
  # Strip line comments, block comments, and single-quoted literals, so a
  # table named "update_log" or a string containing "delete" doesn't trip the
  # scan and, more importantly, so a mutation can't hide inside a literal.
  local stripped
  stripped="$(printf '%s' "$text" |
    sed -E "s/--[^\n]*//g" |
    sed -E "s/\/\*[^*]*\*+([^\/*][^*]*\*+)*\///g" |
    sed -E "s/'[^']*'/''/g")"
  local forbidden=(
    INSERT UPDATE DELETE TRUNCATE MERGE
    CREATE DROP ALTER GRANT REVOKE REINDEX CLUSTER VACUUM ANALYZE
    COMMENT REFRESH IMPORT SECURITY CALL DO
    'COPY[[:space:]]+[^;]*[[:space:]]FROM'
    'SELECT[[:space:]]+[^;]*[[:space:]]FOR[[:space:]]+(UPDATE|SHARE|NO[[:space:]]+KEY[[:space:]]+UPDATE)'
  )
  local kw
  for kw in "${forbidden[@]}"; do
    # Statement position: start of input or just after a semicolon.
    if printf '%s' "$stripped" |
      grep -qiE "(^|;)[[:space:]]*${kw}[[:space:](]"; then
      die "refusing to run a statement matching '${kw}' — this path is read-only. Data changes go through a migration, not an interactive session."
    fi
    # `FOR UPDATE` / `COPY ... FROM` can also appear mid-statement.
    if [[ "$kw" == *"[[:space:]]"* ]] &&
      printf '%s' "$stripped" | grep -qiE "$kw"; then
      die "refusing to run a statement matching '${kw}' — this path is read-only."
    fi
  done
}
assert_read_only "$SQL"

# ── session ───────────────────────────────────────────────────────────────
EXPIRY="$(aws configure get claude_session_expiration --profile "$PROFILE" 2>/dev/null || true)"
[[ -n "$EXPIRY" ]] ||
  die "no session for $ENV_NAME. Run: mise run claude-aws $ENV_NAME <MFA_TOKEN>"
if [[ "$(date -u +%s)" -ge "$(date -u -d "$EXPIRY" +%s 2>/dev/null || echo 0)" ]]; then
  die "session for $ENV_NAME expired at $EXPIRY. Run: mise run claude-aws $ENV_NAME <MFA_TOKEN>"
fi

# ── locate the task that fronts the VPC ───────────────────────────────────
# The realm-server task is only a network hop to RDS; nothing runs in it.
# Filter containers by name — the task also carries a firelens log sidecar
# and DescribeTasks does not promise array order.
TASK_ARN="$(aws --profile "$PROFILE" ecs list-tasks \
  --cluster "$CLUSTER" --service-name "$SERVICE" \
  --query 'taskArns[0]' --output text)"
[[ -n "$TASK_ARN" && "$TASK_ARN" != "None" ]] ||
  die "no running task for $SERVICE in cluster $CLUSTER"
TASK_ID="${TASK_ARN##*/}"
# shellcheck disable=SC2016  # backticks are JMESPath literals; the shell must not expand them
RUNTIME_ID="$(aws --profile "$PROFILE" ecs describe-tasks \
  --cluster "$CLUSTER" --tasks "$TASK_ID" \
  --query 'tasks[0].containers[?name==`boxel-realm-server`].runtimeId | [0]' \
  --output text)"
[[ -n "$RUNTIME_ID" && "$RUNTIME_ID" != "None" ]] ||
  die "could not resolve the realm-server container in task $TASK_ID"

RDS_HOST="$(aws --profile "$PROFILE" ssm get-parameter \
  --name "$SSM_PREFIX/PGHOST" --query 'Parameter.Value' --output text)"
PGDATABASE="$(aws --profile "$PROFILE" ssm get-parameter \
  --name "$SSM_PREFIX/PGDATABASE" --query 'Parameter.Value' --output text)"
DB_USER="$(aws --profile "$PROFILE" ssm get-parameter \
  --name "$SSM_PREFIX/CLAUDE_DB_USER" --query 'Parameter.Value' --output text)"

# ── tunnel ────────────────────────────────────────────────────────────────
LOCAL_PORT=""
for candidate in $(seq 55440 55470); do
  if ! ss -ltn 2>/dev/null | grep -q ":${candidate} "; then
    LOCAL_PORT="$candidate"
    break
  fi
done
[[ -n "$LOCAL_PORT" ]] || die "no free local port in 55440-55470"

TUNNEL_PID=""
cleanup() {
  if [[ -n "$TUNNEL_PID" ]] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
    kill "$TUNNEL_PID" 2>/dev/null || true
    wait "$TUNNEL_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

aws --profile "$PROFILE" ssm start-session \
  --target "ecs:${CLUSTER}_${TASK_ID}_${RUNTIME_ID}" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"portNumber\":[\"5432\"],\"localPortNumber\":[\"$LOCAL_PORT\"],\"host\":[\"$RDS_HOST\"]}" \
  >/dev/null 2>&1 &
TUNNEL_PID=$!

ready=""
for _ in $(seq 1 120); do
  if (exec 3<>"/dev/tcp/127.0.0.1/$LOCAL_PORT") 2>/dev/null; then
    exec 3<&-
    ready=1
    break
  fi
  kill -0 "$TUNNEL_PID" 2>/dev/null || die "the SSM tunnel exited before it was ready"
  sleep 0.5
done
[[ -n "$ready" ]] || die "the SSM tunnel did not open port $LOCAL_PORT within 60s"

# ── connect ───────────────────────────────────────────────────────────────
# Held in a variable for the life of this process and passed per-invocation.
# It is deliberately not exported, not written anywhere, and not printed.
DB_PASSWORD="$(aws --profile "$PROFILE" ssm get-parameter \
  --name "$SSM_PREFIX/CLAUDE_DB_PASSWORD" --with-decryption \
  --query 'Parameter.Value' --output text)"

run_psql() {
  PGPASSWORD="$DB_PASSWORD" psql \
    -h 127.0.0.1 -p "$LOCAL_PORT" -U "$DB_USER" -d "$PGDATABASE" \
    -v ON_ERROR_STOP=1 "$@"
}

# The identity check the aws-access skill requires on every connection: if
# this is not the read-only user, something about the credential path is
# wrong and nothing further should run against a deployed database.
IDENTITY="$(run_psql -A -t -c \
  "SELECT current_user || '|' || pg_has_role(current_user, 'readonly_role', 'member')::text")"
IDENTITY_USER="${IDENTITY%%|*}"
IDENTITY_ROLE="${IDENTITY##*|}"
[[ "$IDENTITY_USER" == "$DB_USER" && "$IDENTITY_ROLE" == "true" ]] ||
  die "connected as '${IDENTITY_USER}' (readonly_role member: ${IDENTITY_ROLE}) — expected ${DB_USER} in readonly_role. Aborting."

if [[ ${#PSQL_PASSTHROUGH[@]} -gt 0 ]]; then
  run_psql "${PSQL_PASSTHROUGH[@]}" -c "$SQL"
else
  run_psql -A -t -c "$SQL"
fi

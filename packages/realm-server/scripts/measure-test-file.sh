#!/usr/bin/env bash
# Measure wall time and peak RSS of running one (or a few) realm-server
# test files in isolation, using the TEST_FILES env var to skip parsing
# the other ~100 files in the suite.
#
# Intended for before/after comparisons across a PR: run on the merge-base,
# run on the PR head, paste the medians into the PR body.

set -euo pipefail

if [ $# -lt 1 ]; then
  cat >&2 <<'USAGE'
Usage: measure-test-file.sh <test-files> [runs]
  test-files  Comma-separated paths relative to packages/realm-server/tests/,
              with or without leading ./ or trailing .ts. Passed verbatim
              as the TEST_FILES env var.
  runs        Number of measurement runs (default: 5).

For each run: prepares a fresh test-pg, then times one qunit invocation
that loads only the requested test files. Reports the median wall time
and median peak RSS across runs (plus min/max for spread).

Examples:
  measure-test-file.sh sanitize-head-html-test
  measure-test-file.sh realm-endpoints/invalidate-urls-test 10
  measure-test-file.sh queue-status-test,invalidate-urls-test 3
USAGE
  exit 1
fi

TEST_FILES_ARG="$1"
RUNS="${2:-5}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEST_SCRIPTS_DIR="${PKG_DIR}/tests/scripts"
QUNIT="${PKG_DIR}/node_modules/.bin/qunit"

if [ ! -x "$QUNIT" ]; then
  echo "qunit binary not found at $QUNIT — run \`pnpm install\` from the repo root first" >&2
  exit 1
fi

if ! [[ "$RUNS" =~ ^[0-9]+$ ]] || [ "$RUNS" -lt 1 ]; then
  echo "runs must be a positive integer, got: $RUNS" >&2
  exit 1
fi

cd "$PKG_DIR"

cleanup() {
  "${TEST_SCRIPTS_DIR}/stop-test-pg.sh" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

times=()
rss_bytes=()

echo "Measuring TEST_FILES=${TEST_FILES_ARG}  (${RUNS} runs)"
echo

for i in $(seq 1 "$RUNS"); do
  "${TEST_SCRIPTS_DIR}/prepare-test-pg.sh" >/dev/null

  timing="$(mktemp)"
  set +e
  /usr/bin/time -l \
    env \
      LOG_LEVELS="*=error,prerenderer-chrome=none,pg-adapter=warn,realm:requests=warn" \
      NODE_NO_WARNINGS=1 \
      NODE_DISABLE_COMPILE_CACHE=1 \
      PGPORT=55436 \
      STRIPE_WEBHOOK_SECRET=stripe-webhook-secret \
      STRIPE_API_KEY=stripe-api-key \
      MATRIX_REGISTRATION_SHARED_SECRET="${MATRIX_REGISTRATION_SHARED_SECRET:-fake}" \
      TEST_FILES="$TEST_FILES_ARG" \
    "$QUNIT" --require ts-node/register/transpile-only tests/index.ts \
    >/dev/null 2>"$timing"
  qunit_status=$?
  set -e

  real=$(awk '/real/ && /user/ && /sys/ {print $1}' "$timing")
  rss=$(awk '/maximum resident set size/ {print $1}' "$timing")

  "${TEST_SCRIPTS_DIR}/stop-test-pg.sh" >/dev/null 2>&1 || true

  if [ "$qunit_status" -ne 0 ] || [ -z "$real" ] || [ -z "$rss" ]; then
    echo "  run ${i}/${RUNS}: qunit exited with status ${qunit_status}; timing output below" >&2
    cat "$timing" >&2
    rm -f "$timing"
    exit 1
  fi
  rm -f "$timing"

  times+=("$real")
  rss_bytes+=("$rss")

  rss_mb=$(awk -v b="$rss" 'BEGIN{printf "%d", b/1048576}')
  printf "  run %d/%d:  %ss   %s MB\n" "$i" "$RUNS" "$real" "$rss_mb"
done

echo

median()  { printf '%s\n' "$@" | sort -n | awk -v n=$# '{a[NR]=$1} END { if (n%2) print a[(n+1)/2]; else printf "%.3f\n", (a[n/2]+a[n/2+1])/2 }'; }
minimum() { printf '%s\n' "$@" | sort -n | head -1; }
maximum() { printf '%s\n' "$@" | sort -n | tail -1; }
to_mb()   { awk -v b="$1" 'BEGIN{printf "%d", b/1048576}'; }

t_med=$(median "${times[@]}")
t_min=$(minimum "${times[@]}")
t_max=$(maximum "${times[@]}")

r_med=$(median "${rss_bytes[@]}")
r_min=$(minimum "${rss_bytes[@]}")
r_max=$(maximum "${rss_bytes[@]}")

printf "  wall time:  median %ss   min %ss   max %ss\n" "$t_med" "$t_min" "$t_max"
printf "  peak RSS:   median %s MB   min %s MB   max %s MB\n" \
  "$(to_mb "$r_med")" "$(to_mb "$r_min")" "$(to_mb "$r_max")"

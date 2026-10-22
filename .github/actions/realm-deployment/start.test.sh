#!/usr/bin/env bash
# Runs start.sh against a scratch git repository, with `gh` and `boxel`
# replaced by stubs, and checks the revisions and push arguments it writes.
#
# The `gh` stub serves the deployment listing from $STUB_DIR/deployments, one
# `id:sha` per line, newest first, and reports a deployment as succeeded when
# its id is in $STUB_DIR/succeeded. The `boxel` stub's `realm push --help`
# prints $STUB_DIR/push-help.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

export STUB_DIR="$work/stub"
mkdir -p "$STUB_DIR/bin"
cat > "$STUB_DIR/bin/gh" <<'EOF'
#!/usr/bin/env bash
case "$2" in
  */deployments\?*)
    [ -f "$STUB_DIR/list-fails" ] && exit 1
    cat "$STUB_DIR/deployments" ;;
  */deployments/*/statuses*)
    id="${2#*/deployments/}"
    id="${id%%/*}"
    if grep -qx "$id" "$STUB_DIR/succeeded"; then echo true; else echo false; fi ;;
  *) echo "unexpected gh call: $*" >&2; exit 2 ;;
esac
EOF
cat > "$STUB_DIR/bin/boxel" <<'EOF'
#!/usr/bin/env bash
cat "$STUB_DIR/push-help"
EOF
chmod +x "$STUB_DIR/bin/gh" "$STUB_DIR/bin/boxel"
export PATH="$STUB_DIR/bin:$PATH"

repo="$work/repo"
git init -q "$repo"
commit() {
  git -C "$repo" -c user.name=test -c user.email=test@example.com commit -q --allow-empty -m "$1"
  git -C "$repo" rev-parse HEAD
}
a=$(commit a)
b=$(commit b)
c=$(commit c)
outside=0123456789abcdef0123456789abcdef01234567

export GITHUB_REPOSITORY=example/repo
export ENVIRONMENT=staging
export REPOSITORY_PATH="$repo"
both_flags=$'  --changed-since <revision>\n  --no-realm-events'

failures=0
# run <name> <expected exit> <expected revisions> <expected push-args>, after
# arranging the stubs with `deployments`, `succeeded` and `help`. Extra
# environment for start.sh goes before the call.
run() {
  local name="$1" want_status="$2" want_revisions="$3" want_args="$4"
  export GITHUB_OUTPUT="$work/output"
  : > "$GITHUB_OUTPUT"
  local status=0
  bash "$here/start.sh" > "$work/log" 2>&1 || status=$?
  local revisions push_args
  revisions=$(sed -n 's/^revisions=//p' "$GITHUB_OUTPUT")
  push_args=$(sed -n 's/^push-args=//p' "$GITHUB_OUTPUT")
  if [ "$status" != "$want_status" ] || [ "$revisions" != "$want_revisions" ] || [ "$push_args" != "$want_args" ]; then
    echo "FAIL: $name"
    echo "  exit:      $status (want $want_status)"
    echo "  revisions: '$revisions' (want '$want_revisions')"
    echo "  push-args: '$push_args' (want '$want_args')"
    sed 's/^/  | /' "$work/log"
    failures=$((failures + 1))
  else
    echo "ok: $name"
  fi
}
deployments() { printf '%s\n' "$@" > "$STUB_DIR/deployments"; }
succeeded() { printf '%s\n' "$@" > "$STUB_DIR/succeeded"; }
cli_help() { printf '%s\n' "$1" > "$STUB_DIR/push-help"; }

deployments 3:"$c" 2:"$b" 1:"$a"
succeeded 2
cli_help "$both_flags"
run "compares against the newest success and every deployment after it" 0 \
  "$c $b" "--changed-since $c --changed-since $b --no-realm-events"

deployments 4:"$c" 3:"$b" 2:"$c" 1:"$a"
succeeded 1
run "lists a revision deployed twice once" 0 \
  "$c $b $a" "--changed-since $c --changed-since $b --changed-since $a --no-realm-events"

deployments 2:"$c" 1:"$b"
succeeded
run "sends every file with no successful deployment" 0 "" "--no-realm-events"
grep -q 'No successful staging deployment' "$work/log" || { echo "FAIL: no notice for a missing success"; failures=$((failures + 1)); }

deployments 2:"$outside" 1:"$b"
succeeded 1
run "sends every file when a revision is outside the history" 0 "" "--no-realm-events"
grep -q "$outside, which the staging realm may hold, isn't in this checkout's history" "$work/log" || { echo "FAIL: no warning for a revision outside the history"; failures=$((failures + 1)); }

touch "$STUB_DIR/list-fails"
run "sends every file when the listing fails" 0 "" "--no-realm-events"
rm "$STUB_DIR/list-fails"

deployments
succeeded
KNOWN_REVISION="$a" run "a known revision stands in for a success" 0 \
  "$a" "--changed-since $a --no-realm-events"

deployments 3:"$c" 2:"$b"
succeeded
KNOWN_REVISION="$a" run "a known revision adds the deployments that never succeeded" 0 \
  "$a $c $b" "--changed-since $a --changed-since $c --changed-since $b --no-realm-events"

deployments 3:"$c" 2:"$b"
succeeded 2
cli_help ""
run "an older boxel-cli gets neither option" 0 "$c $b" ""
grep -q 'no --changed-since' "$work/log" || { echo "FAIL: no notice for a CLI without --changed-since"; failures=$((failures + 1)); }
grep -q 'no --no-realm-events' "$work/log" || { echo "FAIL: no notice for a CLI without --no-realm-events"; failures=$((failures + 1)); }

cli_help "  --changed-since <revision>"
run "a boxel-cli without --no-realm-events still skips unchanged files" 0 \
  "$c $b" "--changed-since $c --changed-since $b"

cli_help "$both_flags"
deployments 2:"$c"
succeeded
REQUIRE_REVISIONS=true run "require-revisions refuses to send every file" 1 "" ""

deployments 3:"$c" 2:"$b"
succeeded 2
cli_help "  --no-realm-events"
REQUIRE_REVISIONS=true run "require-revisions refuses a boxel-cli without --changed-since" 1 "" ""

# PATH without the boxel stub, or any installed boxel. git and the shell
# utilities come from the system directories.
mkdir -p "$STUB_DIR/no-boxel"
ln -s "$STUB_DIR/bin/gh" "$STUB_DIR/no-boxel/gh"
deployments 3:"$c" 2:"$b"
succeeded 2
PATH="$STUB_DIR/no-boxel:/usr/bin:/bin" run "a missing boxel-cli fails before anything is recorded" 1 "" ""
grep -q "boxel isn't on PATH" "$work/log" || { echo "FAIL: no error for a missing boxel-cli"; failures=$((failures + 1)); }

if [ "$failures" -ne 0 ]; then
  echo "$failures failure(s)"
  exit 1
fi

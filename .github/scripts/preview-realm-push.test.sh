#!/usr/bin/env bash
# Runs the reusable preview workflow's push step against fixture checkouts,
# with a stand-in `boxel` that records where it ran and what it was given.
#
# Usage: preview-realm-push.test.sh <file holding the push step's script>
set -uo pipefail

step=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
failures=0

fail() {
  echo "not ok - $1"
  failures=$((failures + 1))
}

# Makes a fresh checkout at $ws, a runner temp at $tmp, and the stand-in CLI.
fixture() {
  rm -rf "${root:?}"/*
  ws="$root/ws" tmp="$root/tmp" outside="$root/outside" log="$root/boxel.log"
  mkdir -p "$ws/cards/foo" "$tmp" "$outside/dir" "$root/bin"
  echo 'export const x = 1;' > "$ws/cards/foo/x.gts"
  echo 'node_modules' > "$ws/cards/.gitignore"
  echo 'SECRET=from-the-checkout' > "$ws/.env"
  echo 'runner secret' > "$outside/secret"
  echo 'runner secret' > "$outside/dir/secret"
  cat > "$root/bin/boxel" <<STUB
#!/usr/bin/env bash
{ echo "cwd=\$(pwd -P)"; echo "dir=\$3"; (cd "\$3" && find . -type f | sort); } > "$log"
STUB
  chmod +x "$root/bin/boxel"
}

# Runs the step the way the runner does, from a directory that is not the
# checkout. Sets $status.
run_step() {
  (
    cd "$tmp" &&
      GITHUB_WORKSPACE="$ws" RUNNER_TEMP="$tmp" REALM_SERVER=https://realm.test/ \
        MATRIX_USERNAME=bot REALM_ENDPOINT=pr-1 PUSH_PATHS="$1" \
        PATH="$root/bin:$PATH" bash --noprofile --norc -eo pipefail "$step"
  ) > "$root/out.log" 2>&1
  status=$?
}

refused() {
  run_step "$2"
  if [ "$status" -eq 0 ] || [ -e "$log" ]; then
    fail "$1"
    cat "$root/out.log"
  else
    echo "ok - $1"
  fi
}

fixture
run_step 'cards/foo'
if [ "$status" -eq 0 ] &&
  grep -qx "cwd=$(cd "$tmp" && pwd -P)" "$log" &&
  grep -qx './cards/foo/x.gts' "$log" &&
  grep -qx './cards/.gitignore' "$log" &&
  ! grep -q '\.env' "$log"; then
  echo 'ok - a listed folder is staged with the ignore file above it, and the CLI runs outside the checkout'
else
  fail 'a listed folder is staged with the ignore file above it, and the CLI runs outside the checkout'
  cat "$root/out.log" "$log" 2> /dev/null
fi

fixture
run_step ''
if [ "$status" -eq 0 ] &&
  grep -qx "cwd=$(cd "$tmp" && pwd -P)" "$log" &&
  grep -qx "dir=$ws" "$log"; then
  echo 'ok - a whole-repository push runs the CLI outside the checkout'
else
  fail 'a whole-repository push runs the CLI outside the checkout'
  cat "$root/out.log" "$log" 2> /dev/null
fi

fixture
ln -s "$outside/dir" "$ws/linked"
refused 'a listed path that is a symbolic link is refused' 'linked'

fixture
ln -s "$outside/dir" "$ws/linked"
refused 'a trailing slash does not get a linked path past the check' 'linked/'

fixture
ln -s "$outside" "$ws/parent"
refused 'a listed path reached through a linked folder is refused' 'parent/dir'

fixture
rm "$ws/cards/.gitignore"
ln -s "$outside/secret" "$ws/cards/.gitignore"
run_step 'cards/foo'
if [ "$status" -eq 0 ] && ! grep -q 'gitignore' "$log" &&
  ! grep -rq 'runner secret' "$tmp/preview-content"; then
  echo 'ok - a linked ignore file above a listed path is not staged'
else
  fail 'a linked ignore file above a listed path is not staged'
  cat "$root/out.log" "$log" 2> /dev/null
fi

fixture
refused 'a path outside the repository is refused' '../outside'

[ "$failures" -eq 0 ]

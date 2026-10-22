#!/usr/bin/env bash
# Finds the revisions a realm may hold, and the `boxel realm push` arguments
# that skip a file only when it's unchanged against every one of them. The
# start action runs it; its action.yml describes the inputs, which arrive here
# as environment variables. Writes `revisions` and `push-args` to
# $GITHUB_OUTPUT.
#
# The newest deployment to the environment that succeeded names a revision the
# realm holds in full. Each deployment recorded after it failed or never
# finished, so the realm may hold part of its revision too. A file any of them
# may have written is therefore sent again. KNOWN_REVISION, when set, is a
# revision the realm is known to hold, and stands in for a successful
# deployment when none is found.
#
# With no revision to compare against, or one the checkout's history doesn't
# reach, the push sends every file, unless REQUIRE_REVISIONS refuses that.

set -euo pipefail

: "${ENVIRONMENT:?}" "${GITHUB_REPOSITORY:?}" "${GITHUB_OUTPUT:?}"
REPOSITORY_PATH="${REPOSITORY_PATH:-.}"
KNOWN_REVISION="${KNOWN_REVISION:-}"
REQUIRE_REVISIONS="${REQUIRE_REVISIONS:-false}"
title="$ENVIRONMENT realm sync"

# The push arguments come from the installed boxel-cli's --help, so a missing
# CLI would read as an old one and the push would send every file.
command -v boxel > /dev/null || {
  echo "::error title=$title::boxel isn't on PATH. Run realm-deployment/start after installing @cardstack/boxel-cli."
  exit 1
}

revisions=""
add_revision() {
  case " $revisions " in
    *" $1 "*) ;;
    *) revisions="${revisions:+$revisions }$1" ;;
  esac
}

if [ -n "$KNOWN_REVISION" ]; then
  add_revision "$KNOWN_REVISION"
fi

# A failed listing reads as no deployments, the same as a repository that has
# never recorded one.
rows=$(gh api "repos/$GITHUB_REPOSITORY/deployments?environment=$ENVIRONMENT&per_page=30" --jq '.[] | "\(.id):\(.sha)"') || {
  echo "::warning title=$title::Couldn't list the $ENVIRONMENT deployments."
  rows=""
}
succeeded=false
for row in $rows; do
  add_revision "${row#*:}"
  if [ "$(gh api "repos/$GITHUB_REPOSITORY/deployments/${row%%:*}/statuses?per_page=100" --jq 'any(.[]; .state == "success")' || true)" = "true" ]; then
    succeeded=true
    break
  fi
done

if [ "$succeeded" != "true" ] && [ -z "$KNOWN_REVISION" ]; then
  echo "::notice title=$title::No successful $ENVIRONMENT deployment is recorded, so this sync sends every file."
  revisions=""
fi
for revision in $revisions; do
  if ! git -C "$REPOSITORY_PATH" cat-file -e "$revision^{commit}" 2>/dev/null; then
    echo "::warning title=$title::$revision, which the $ENVIRONMENT realm may hold, isn't in this checkout's history, so this sync sends every file."
    revisions=""
    break
  fi
done
echo "The $ENVIRONMENT realm may hold: ${revisions:-(unknown)}"

# A boxel-cli that doesn't list an option rejects it, so each one is passed
# only when `realm push --help` lists it.
push_help=$(boxel realm push --help 2>&1 || true)
push_args=()
if grep -q -- '--changed-since' <<< "$push_help"; then
  for revision in $revisions; do
    push_args+=(--changed-since "$revision")
  done
elif [ -n "$revisions" ]; then
  echo "::notice title=$title::This boxel-cli has no --changed-since, so every file goes up."
fi

if [ "$REQUIRE_REVISIONS" = "true" ] && [ ${#push_args[@]} -eq 0 ]; then
  echo "::error title=$title::No revision to compare against, so the push would send every file."
  exit 1
fi

# A sync is system-initiated, so the realm indexes it without announcing it to
# its open tabs, which pick the new content up on their next load instead of
# resetting mid-session.
if grep -q -- '--no-realm-events' <<< "$push_help"; then
  push_args+=(--no-realm-events)
  echo "Pushing with --no-realm-events: open tabs pick the changes up on their next load."
else
  echo "::notice title=$title::This boxel-cli has no --no-realm-events, so the push is announced to open tabs."
fi

{
  echo "revisions=$revisions"
  echo "push-args=${push_args[*]}"
} >> "$GITHUB_OUTPUT"

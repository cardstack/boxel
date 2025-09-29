#!/usr/bin/env bash
set -euo pipefail

# ci-bisect.sh — assist git bisect by pushing each step to CI
# Usage:
#   ./scripts/ci-bisect.sh start <good_commit> [<bad_ref>]
#   ./scripts/ci-bisect.sh step good|bad|skip
#   ./scripts/ci-bisect.sh status
#   ./scripts/ci-bisect.sh abort
#
# It uses the branch name 'ci-bisect' on origin. Change via $BISect_BRANCH
#
# Implementation detail:
# - For every tested revision, we create an empty commit with message
#   "ci-bisect: test <sha>" on top of the checked-out candidate. We push this
#   marker commit to ensure GitHub sees a new commit on the branch and runs CI.
# - When you later run `step good|bad|skip`, we attribute the verdict to the
#   underlying tested commit (the parent of the marker), not the marker itself.

BRANCH_NAME=${BISect_BRANCH:-ci-bisect}
REMOTE=${BISect_REMOTE:-origin}
DEFAULT_REMOTE_HEAD=$(git remote show "$REMOTE" | sed -n 's/^\s*HEAD branch: //p')
REPO_URL_BASE=$(git remote get-url "$REMOTE" | sed -E 's#^git@github.com:#https://github.com/#; s#\.git$##')

ensure_clean() {
  if ! git diff --quiet; then
    echo "Working tree has unstaged changes. Commit or stash first." >&2
    exit 1
  fi
  if ! git diff --cached --quiet; then
    echo "Index has staged changes. Commit or stash first." >&2
    exit 1
  fi
}

tested_sha() {
  # If HEAD is a marker commit, extract the tested SHA from its subject.
  local subj
  subj=$(git show -s --format=%s HEAD 2>/dev/null || true)
  case "$subj" in
    "ci-bisect: test "*) echo "${subj#ci-bisect: test }" ;;
    *) git rev-parse HEAD ;;
  esac
}

make_marker_commit() {
  local base_sha
  base_sha=$(git rev-parse --short=12 HEAD)
  # Create a unique empty commit so GH Actions always runs
  GIT_COMMITTER_DATE="$(date -u)" GIT_AUTHOR_DATE="$(date -u)" \
    git commit --allow-empty -m "ci-bisect: test $(git rev-parse HEAD)" >/dev/null
  echo "Created marker commit on top of $base_sha"
}

push_current() {
  # Ensure we push a new commit so GH treats it as new work
  make_marker_commit
  local push_sha branch_head tested
  push_sha=$(git rev-parse --short=12 HEAD)
  tested=$(tested_sha)
  echo "Pushing $push_sha (tests for $tested) -> $REMOTE/$BRANCH_NAME"
  git push -f "$REMOTE" HEAD:"refs/heads/$BRANCH_NAME"
  echo "Pushed. Branch head commit: $REPO_URL_BASE/commit/$(git rev-parse HEAD)"
  echo "Branch checks: $REPO_URL_BASE/actions?query=branch%3A$BRANCH_NAME"
  echo "Tested revision: $REPO_URL_BASE/commit/$tested"
}

cmd_start() {
  local good bad
  good=${1:?"Provide known-good commit (sha or ref)"}
  bad=${2:-HEAD}
  ensure_clean
  echo "Starting bisect: good=$good bad=$bad"
  git bisect reset || true
  git bisect start "$bad" "$good"
  push_current
}

cmd_step() {
  local verdict=${1:?"Provide one of: good|bad|skip"}
  # Attribute verdict to the actual tested commit (parent of our marker if present)
  local tested
  tested=$(tested_sha)
  case "$verdict" in
    good) git bisect good "$tested";;
    bad) git bisect bad "$tested";;
    skip) git bisect skip "$tested";;
    *) echo "Unknown: $verdict"; exit 2;;
  esac
  # After stepping, bisect will check out the next candidate.
  if git rev-parse -q --verify HEAD >/dev/null; then
    push_current
  fi
}

cmd_status() {
  git bisect log || true
  local tested
  tested=$(tested_sha)
  echo "Current head: $(git rev-parse --short=12 HEAD)"
  echo "Tested commit: $(git rev-parse --short=12 "$tested")"
}

cmd_abort() {
  git bisect reset || true
}

case "${1:-}" in
  start) shift; cmd_start "$@";;
  step) shift; cmd_step "$@";;
  status) shift; cmd_status "$@";;
  abort) shift; cmd_abort "$@";;
  *) cat <<USAGE
ci-bisect.sh help
  start <good_commit> [bad]
  step good|bad|skip
  status
  abort
Environment:
  BISect_BRANCH (default: ci-bisect)
  BISect_REMOTE (default: origin)
USAGE
     ;;
 esac

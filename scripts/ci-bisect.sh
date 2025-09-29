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
REPO_ROOT=$(git rev-parse --show-toplevel)

# Optional: overlay workflow and this script into each tested revision so CI always runs as intended.
# Enable by setting BISect_COPY_CI=1. Paths can be customized below.
OVERLAY_ENABLE=${BISect_COPY_CI:-0}
OVERLAY_PATH=${BISect_CI_PATH:-.github/workflows/ci.yaml}
OVERLAY_STORE=${BISect_CI_STORE:-.git/ci-bisect/ci.yaml}
OVERLAY_SCRIPT_PATH=${BISect_SCRIPT_PATH:-scripts/ci-bisect.sh}
OVERLAY_SCRIPT_STORE=${BISect_SCRIPT_STORE:-.git/ci-bisect/ci-bisect.sh}

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

overlay_capture() {
  # Capture the current workflow and script content into .git for reuse on every step
  if [[ "$OVERLAY_ENABLE" != "1" ]]; then
    return 0
  fi
  mkdir -p "$(dirname "$OVERLAY_STORE")"
  if [[ -f "$OVERLAY_PATH" ]]; then
    cp "$REPO_ROOT/$OVERLAY_PATH" "$OVERLAY_STORE" 2>/dev/null || cp "$OVERLAY_PATH" "$OVERLAY_STORE" 2>/dev/null || true
    echo "Captured overlay from $OVERLAY_PATH -> $OVERLAY_STORE"
  else
    echo "Warning: BISect_COPY_CI=1 but $OVERLAY_PATH not found; skipping workflow capture" >&2
  fi
  # Capture the current script as well so subsequent steps include it
  mkdir -p "$(dirname "$OVERLAY_SCRIPT_STORE")"
  if [[ -f "$REPO_ROOT/$OVERLAY_SCRIPT_PATH" ]]; then
    cp "$REPO_ROOT/$OVERLAY_SCRIPT_PATH" "$OVERLAY_SCRIPT_STORE"
    echo "Captured overlay script from $OVERLAY_SCRIPT_PATH -> $OVERLAY_SCRIPT_STORE"
  elif [[ -f "$OVERLAY_SCRIPT_PATH" ]]; then
    cp "$OVERLAY_SCRIPT_PATH" "$OVERLAY_SCRIPT_STORE"
    echo "Captured overlay script from $OVERLAY_SCRIPT_PATH -> $OVERLAY_SCRIPT_STORE"
  else
    echo "Warning: Could not find $OVERLAY_SCRIPT_PATH to capture; skipping script capture" >&2
  fi
}

overlay_apply_if_present() {
  # Apply stored overlay(s) to working tree before committing marker
  local applied=0
  if [[ -f "$OVERLAY_STORE" ]]; then
    mkdir -p "$(dirname "$OVERLAY_PATH")"
    cp "$OVERLAY_STORE" "$OVERLAY_PATH"
    git add "$OVERLAY_PATH"
    echo "Applied overlay to $OVERLAY_PATH"
    applied=1
  fi
  if [[ -f "$OVERLAY_SCRIPT_STORE" ]]; then
    mkdir -p "$(dirname "$OVERLAY_SCRIPT_PATH")"
    cp "$OVERLAY_SCRIPT_STORE" "$OVERLAY_SCRIPT_PATH"
    git add "$OVERLAY_SCRIPT_PATH"
    echo "Applied overlay to $OVERLAY_SCRIPT_PATH"
    applied=1
  fi
  if [[ $applied -eq 1 ]]; then
    return 0
  fi
  return 1
}

tested_sha() {
  # If HEAD is a marker commit, extract just the tested SHA from its subject.
  local subj rem first
  subj=$(git show -s --format=%s HEAD 2>/dev/null || true)
  case "$subj" in
    "ci-bisect: test "*)
      rem=${subj#ci-bisect: test }
      first=${rem%%[[:space:]]*}
      echo "$first"
      ;;
    *) git rev-parse HEAD ;;
  esac
}

make_marker_commit() {
  local base_sha
  base_sha=$(git rev-parse --short=12 HEAD)
  local tested_full
  tested_full=$(git rev-parse HEAD)
  local msg_suffix=""
  if overlay_apply_if_present; then
    msg_suffix=" [ci-overlay]"
    GIT_COMMITTER_DATE="$(date -u)" GIT_AUTHOR_DATE="$(date -u)" \
      git commit -m "ci-bisect: test $tested_full$msg_suffix" >/dev/null
  else
    # Create a unique empty commit so GH Actions always runs
    GIT_COMMITTER_DATE="$(date -u)" GIT_AUTHOR_DATE="$(date -u)" \
      git commit --allow-empty -m "ci-bisect: test $tested_full" >/dev/null
  fi
  echo "Created marker commit on top of $base_sha"
}

push_current() {
  # Create a marker commit (may include overlay files), then produce a synthetic
  # commit whose parent is the latest $DEFAULT_REMOTE_HEAD (e.g., origin/main)
  # so that from GitHub's perspective this appears as a fresh update on top of main.
  make_marker_commit

  # Ensure we have up-to-date remote refs
  git fetch --no-tags --prune "$REMOTE" >/dev/null 2>&1 || true

  local tested tested_short parent_ref parent_sha tree new_commit branch_dyn
  tested=$(tested_sha)
  tested_short=$(git rev-parse --short=12 "$tested")
  parent_ref="refs/remotes/$REMOTE/$DEFAULT_REMOTE_HEAD"
  parent_sha=$(git rev-parse "$parent_ref")
  tree=$(git rev-parse HEAD^{tree})

  # Create a synthetic commit: same tree as marker commit, parented to origin/main
  new_commit=$(GIT_AUTHOR_DATE="$(date -u)" GIT_COMMITTER_DATE="$(date -u)" \
    git commit-tree "$tree" -p "$parent_sha" -m "ci-bisect: test $tested [rebased-on-$DEFAULT_REMOTE_HEAD]")

  branch_dyn="$BRANCH_NAME-$tested_short"
  echo "Pushing $new_commit (tree from tested $tested_short on parent $DEFAULT_REMOTE_HEAD) -> $REMOTE/$branch_dyn"
  git push -f "$REMOTE" "$new_commit":"refs/heads/$branch_dyn"
  echo "Pushed. Branch head commit: $REPO_URL_BASE/commit/$new_commit"
  echo "Branch checks: $REPO_URL_BASE/actions?query=branch%3A$branch_dyn"
  echo "Tested revision: $REPO_URL_BASE/commit/$tested"
}

cmd_start() {
  local good bad
  good=${1:?"Provide known-good commit (sha or ref)"}
  bad=${2:-HEAD}
  ensure_clean
  overlay_capture
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
  refresh-overlay) shift; overlay_capture; echo "Overlay refreshed.";;
  *) cat <<USAGE
ci-bisect.sh help
  start <good_commit> [bad]
  step good|bad|skip
  status
  abort
  refresh-overlay
Environment:
  BISect_BRANCH (default: ci-bisect)
  BISect_REMOTE (default: origin)
  BISect_COPY_CI=1 to enable overlay of workflow and script
  BISect_CI_PATH (default: .github/workflows/ci.yaml)
  BISect_CI_STORE (default: .git/ci-bisect/ci.yaml)
  BISect_SCRIPT_PATH (default: scripts/ci-bisect.sh)
  BISect_SCRIPT_STORE (default: .git/ci-bisect/ci-bisect.sh)
USAGE
     ;;
 esac

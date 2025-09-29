#!/usr/bin/env bash
set -euo pipefail

# ci-bisect.sh — assist git bisect by pushing each step to CI
# Usage (global flags first):
#   ./scripts/ci-bisect.sh [--merges-only|--no-merges-only] start <good_commit> [<bad_ref>]  # init + push first
#   ./scripts/ci-bisect.sh [--merges-only|--no-merges-only] step good|bad|skip               # mark + push next
#   ./scripts/ci-bisect.sh [--merges-only|--no-merges-only] status                           # show bisect status
#   ./scripts/ci-bisect.sh [--merges-only|--no-merges-only] abort                            # reset bisect
#   ./scripts/ci-bisect.sh refresh-overlay                                                   # re-capture overlay
#   ./scripts/ci-bisect.sh test <commit>                                                     # CI test a commit
#
# Branches: base name 'ci-bisect' (config via $BISect_BRANCH); each step pushes to 'ci-bisect-<shortsha>'.
# Overlay: enable with BISect_COPY_CI=1; copies specified files (and this script) into each tested revision.
# Merges-only: default OFF. Use --merges-only to consider only commits with subject
# starting "Merge pull request". This setting persists across runs (sticky).
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
CI_BISECT_DIR=.git/ci-bisect
OPTIONS_FILE=$CI_BISECT_DIR/options

# Optional: overlay workflow and this script into each tested revision so CI always runs as intended.
# Enable by setting BISect_COPY_CI=1. Paths can be customized below.
OVERLAY_ENABLE=${BISect_COPY_CI:-0}
OVERLAY_PATH=${BISect_CI_PATH:-.github/workflows/ci.yaml}
OVERLAY_SCRIPT_PATH=${BISect_SCRIPT_PATH:-scripts/ci-bisect.sh}

# Allow multiple overlay paths (space-separated) via BISect_CI_PATHS; falls back to single OVERLAY_PATH
OVERLAY_PATHS=${BISect_CI_PATHS:-$OVERLAY_PATH}

# Derive default STORE locations from the PATHs under .git/ci-bisect/<PATH>,
# while allowing explicit overrides via BISect_CI_STORE and BISect_SCRIPT_STORE.
derive_store_path() {
  local p="$1"
  # strip leading ./ if present
  p="${p#./}"
  echo ".git/ci-bisect/$p"
}

DEFAULT_OVERLAY_SCRIPT_STORE=$(derive_store_path "$OVERLAY_SCRIPT_PATH")
# For multiple overlay paths, stores are derived per path, so no single OVERLAY_STORE is used.
OVERLAY_SCRIPT_STORE=${BISect_SCRIPT_STORE:-$DEFAULT_OVERLAY_SCRIPT_STORE}

# Option: Only evaluate PR merge commits (subject starts with 'Merge pull request')
PR_MERGES_ONLY=${BISect_PR_MERGES_ONLY:-0}

is_pr_merge_commit() {
  local sha=${1:-HEAD}
  local subj
  subj=$(git show -s --format=%s "$sha" 2>/dev/null || true)
  [[ "$subj" == Merge\ pull\ request* ]]
}

# Persisted options handling
load_options() {
  if [[ -f "$OPTIONS_FILE" ]]; then
    # shellcheck disable=SC1090
    . "$OPTIONS_FILE"
  fi
}

save_options() {
  mkdir -p "$CI_BISECT_DIR"
  {
    echo "# ci-bisect persisted options"
    echo "PR_MERGES_ONLY=${PR_MERGES_ONLY}"
  } > "$OPTIONS_FILE"
}

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
  # Capture the current workflow(s) and script content into .git for reuse on every step
  if [[ "$OVERLAY_ENABLE" != "1" ]]; then
    return 0
  fi
  for p in $OVERLAY_PATHS; do
    local store
    store=$(derive_store_path "$p")
    mkdir -p "$(dirname "$store")"
    if [[ -f "$REPO_ROOT/$p" ]]; then
      cp "$REPO_ROOT/$p" "$store"
      echo "Captured overlay from $p -> $store"
    elif [[ -f "$p" ]]; then
      cp "$p" "$store"
      echo "Captured overlay from $p -> $store"
    else
      echo "Warning: BISect_COPY_CI=1 but $p not found; skipping" >&2
    fi
  done
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
  for p in $OVERLAY_PATHS; do
    local store
    store=$(derive_store_path "$p")
    if [[ -f "$store" ]]; then
      mkdir -p "$(dirname "$p")"
      cp "$store" "$p"
      git add "$p"
      echo "Applied overlay to $p"
      applied=1
    fi
  done
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
# Detect whether a bisect session is currently active
bisect_active() {
  git rev-parse -q --verify BISECT_HEAD >/dev/null 2>&1
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
  # If restricting to PR merges only and current candidate isn't a merge, advance until it is
  if [[ "$PR_MERGES_ONLY" == "1" ]]; then
    while ! is_pr_merge_commit HEAD; do
      git bisect skip
      # Stop if bisect is done
      git rev-parse -q --verify HEAD >/dev/null || break
    done
  fi
  if bisect_active; then
    push_current
  else
    echo "Bisect ended (no candidates). Not pushing; run 'status' or 'classify-skipped' if needed."
  fi
}

cmd_step() {
  local verdict=${1:?"Provide one of: good|bad|skip"}
  # Attribute verdict to the actual tested commit (parent of our marker if present)
  local tested
  tested=$(tested_sha)
  # If restricting to PR merges only, auto-skip non-merge candidates
  if [[ "$PR_MERGES_ONLY" == "1" ]]; then
    if ! is_pr_merge_commit "$tested"; then
      echo "--merges-only: skipping non-merge candidate $(git rev-parse --short=12 "$tested") before verdict"
      git bisect skip "$tested"
      # After skipping, bisect will check out the next candidate.
      if git rev-parse -q --verify HEAD >/dev/null; then
        push_current
      fi
      return 0
    fi
  fi
  case "$verdict" in
    good) git bisect good "$tested";;
    bad) git bisect bad "$tested";;
    skip) git bisect skip "$tested";;
    *) echo "Unknown: $verdict"; exit 2;;
  esac
  # After stepping, bisect will check out the next candidate.
  if git rev-parse -q --verify HEAD >/dev/null; then
    # Enforce --merges-only post-advance as well: skip forward until HEAD is a PR merge
    if [[ "$PR_MERGES_ONLY" == "1" ]]; then
      while git rev-parse -q --verify HEAD >/dev/null && ! is_pr_merge_commit HEAD; do
        echo "--merges-only: skipping non-merge candidate $(git rev-parse --short=12 HEAD) after verdict"
        git bisect skip
      done
    fi
    if bisect_active; then
      push_current
    else
      echo "Bisect ended (likely only skipped commits left). Auto-aborting to restore state."
      git bisect reset || true
    fi
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

load_options

# Parse global flags before subcommand
while [[ $# -gt 0 ]]; do
  case "$1" in
    --merges-only)
      PR_MERGES_ONLY=1; shift ;;
    --no-merges-only)
      PR_MERGES_ONLY=0; shift ;;
    --) shift; break ;;
    start|step|status|abort|refresh-overlay|test)
      break ;;
    *) break ;;
  esac
done

save_options

case "${1:-}" in
  start) shift; cmd_start "$@";;
  step) shift; cmd_step "$@";;
  status) shift; cmd_status "$@";;
  abort) shift; cmd_abort "$@";;
  refresh-overlay) shift; overlay_capture; echo "Overlay refreshed.";;
  test)
    shift
    # Test an arbitrary commit/ref by generating a synthetic commit on top of main and pushing it
    # Usage: ci-bisect.sh test <commit>
    ensure_clean
    overlay_capture
    target=${1:?-"Provide a commit/ref to test"}
    # Save current ref to restore later
    current_ref=$(git symbolic-ref -q --short HEAD || git rev-parse HEAD)
    trap 'git checkout -q "$current_ref" >/dev/null 2>&1 || true' EXIT
    git checkout -q "$target"
    tested=$(git rev-parse HEAD)
    tested_short=$(git rev-parse --short=12 HEAD)
    # Create marker and possibly overlay
    make_marker_commit
    # Build synthetic commit parented on latest remote default branch
    git fetch --no-tags --prune "$REMOTE" >/dev/null 2>&1 || true
    parent_ref="refs/remotes/$REMOTE/$DEFAULT_REMOTE_HEAD"
    parent_sha=$(git rev-parse "$parent_ref")
    tree=$(git rev-parse HEAD^{tree})
    new_commit=$(GIT_AUTHOR_DATE="$(date -u)" GIT_COMMITTER_DATE="$(date -u)" \
      git commit-tree "$tree" -p "$parent_sha" -m "ci-test: test $tested [rebased-on-$DEFAULT_REMOTE_HEAD]")
    prefix=${BISect_TEST_BRANCH_PREFIX:-ci-test}
    branch_dyn="$prefix-$tested_short"
    echo "Pushing $new_commit (tree from tested $tested_short on parent $DEFAULT_REMOTE_HEAD) -> $REMOTE/$branch_dyn"
    git push -f "$REMOTE" "$new_commit":"refs/heads/$branch_dyn"
    echo "Pushed. Branch head commit: $REPO_URL_BASE/commit/$new_commit"
    echo "Branch checks: $REPO_URL_BASE/actions?query=branch%3A$branch_dyn"
    echo "Tested revision: $REPO_URL_BASE/commit/$tested"
    # Restore original ref
    git checkout -q "$current_ref"
    trap - EXIT
    ;;
  *) cat <<USAGE
ci-bisect.sh help
  [--merges-only|--no-merges-only]
  start <good_commit> [bad]   Initialize bisect and push first candidate to CI
  step good|bad|skip          Mark verdict for current candidate and push next
  status                      Show bisect log and current tested commit
  abort                       Reset bisect to original state
  refresh-overlay             Re-capture workflow/script from working tree
  test <commit>               Push CI for an arbitrary commit without bisecting

Notes:
  - When BISect_COPY_CI=1, the workflow file and this script are overlaid into
  each tested revision before pushing, to force full CI runs. You can provide
  multiple overlay paths via BISect_CI_PATHS (space-separated).
  - Each push is a synthetic commit parented on the latest '$DEFAULT_REMOTE_HEAD'
    so GitHub treats it as new code on top of main (not "behind main").
  - Bisect step branches: "$BISect_BRANCH-<shortsha>".
  - Direct test branches:  "${BISect_TEST_BRANCH_PREFIX:-ci-test}-<shortsha>".

Examples:
  BISect_COPY_CI=1 ./scripts/ci-bisect.sh start <good-sha> [bad-ref]
  ./scripts/ci-bisect.sh step good   # or bad/skip
  BISect_COPY_CI=1 ./scripts/ci-bisect.sh test <sha>
  BISect_COPY_CI=1 BISect_CI_PATHS=".github/workflows/ci.yaml packages/host/scripts/test-wait-for-servers.sh" \
    ./scripts/ci-bisect.sh start <good-sha>
  ./scripts/ci-bisect.sh --merges-only start <good-sha>
Environment:
  BISect_BRANCH (default: ci-bisect)
  BISect_REMOTE (default: origin)
  BISect_COPY_CI=1 to enable overlay of workflow and script
  BISect_CI_PATH (default: .github/workflows/ci.yaml)
  BISect_CI_PATHS (optional, space-separated list; overrides BISect_CI_PATH)
  BISect_CI_STORE (default: derived from path => .git/ci-bisect/<C I PATH>)
  BISect_SCRIPT_PATH (default: scripts/ci-bisect.sh)
  BISect_SCRIPT_STORE (default: derived from path => .git/ci-bisect/<SCRIPT PATH>)
  BISect_TEST_BRANCH_PREFIX (default: ci-test)
  BISect_PR_MERGES_ONLY=1 to test only commits with subject starting "Merge pull request"
Flags:
  --merges-only / --no-merges-only  Toggle PR merges only mode (persists in .git/ci-bisect/options)
Defaults:
  - PR merges only: OFF by default. When toggled via flags, the setting is saved and reused.
USAGE
     ;;
 esac

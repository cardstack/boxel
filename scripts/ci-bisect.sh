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

# Internal state and repo metadata
CI_BISECT_DIR=.git/ci-bisect
OPTIONS_FILE=$CI_BISECT_DIR/options
OWNER=$(echo "$REPO_URL_BASE" | awk -F/ '{print $(NF-1)}')
REPO=$(echo "$REPO_URL_BASE" | awk -F/ '{print $NF}')

# Optional: overlay workflow and this script into each tested revision so CI always runs as intended.
# Enable by setting BISect_COPY_CI=1. Paths can be customized below.
OVERLAY_ENABLE=${BISect_COPY_CI:-0}
OVERLAY_PATH=${BISect_CI_PATH:-.github/workflows/ci.yaml}
OVERLAY_STORE=${BISect_CI_STORE:-.git/ci-bisect/ci.yaml}
OVERLAY_SCRIPT_PATH=${BISect_SCRIPT_PATH:-scripts/ci-bisect.sh}
OVERLAY_SCRIPT_STORE=${BISect_SCRIPT_STORE:-.git/ci-bisect/ci-bisect.sh}

# Optional: run bisect in a dedicated worktree so this script remains usable
# even when checking out very old commits that predate it. Enabled by default.
# Set BISect_USE_WORKTREE=0 to disable.
USE_WORKTREE=${BISect_USE_WORKTREE:-1}
WORKTREE_DIR="$REPO_ROOT/.git/ci-bisect/wt"

# Bootstrap: if using worktree and we're not already inside the worktree,
# create it (detached at HEAD) and re-exec the saved helper from .git.
if [[ "$USE_WORKTREE" == "1" && "${BISect_IN_WT:-}" != "1" ]]; then
  # Ensure a saved copy of this script exists under .git at a stable path
  mkdir -p "$REPO_ROOT/.git/ci-bisect"
  if [[ -f "$REPO_ROOT/scripts/ci-bisect.sh" ]]; then
    cp "$REPO_ROOT/scripts/ci-bisect.sh" "$REPO_ROOT/.git/ci-bisect/ci-bisect.sh" 2>/dev/null || true
    chmod +x "$REPO_ROOT/.git/ci-bisect/ci-bisect.sh" 2>/dev/null || true
  fi
  # Create or update the worktree detached at current HEAD
  if [[ ! -d "$WORKTREE_DIR/.git" ]]; then
    git worktree add --detach "$WORKTREE_DIR" >/dev/null 2>&1 || true
  fi
  # Re-exec inside the worktree, using the saved helper to avoid relying on
  # the script existing at that historical revision.
  if [[ -x "$REPO_ROOT/.git/ci-bisect/ci-bisect.sh" ]]; then
    BISect_IN_WT=1 exec bash "$REPO_ROOT/.git/ci-bisect/ci-bisect.sh" "$@"
  fi
fi

# Stable invoker: keep a copy of this script in .git so it's callable even when
# the checked-out revision doesn't contain scripts/ci-bisect.sh (common during bisect).
install_stable_invoker() {
  mkdir -p "$(dirname "$OVERLAY_SCRIPT_STORE")"
  if [[ -f "$REPO_ROOT/$OVERLAY_SCRIPT_PATH" ]]; then
    cp "$REPO_ROOT/$OVERLAY_SCRIPT_PATH" "$OVERLAY_SCRIPT_STORE" 2>/dev/null || true
  elif [[ -f "$OVERLAY_SCRIPT_PATH" ]]; then
    cp "$OVERLAY_SCRIPT_PATH" "$OVERLAY_SCRIPT_STORE" 2>/dev/null || true
  fi
  chmod +x "$OVERLAY_SCRIPT_STORE" 2>/dev/null || true

  local wrapper
  wrapper="$REPO_ROOT/.git/ci-bisect/ci-bisect"
  mkdir -p "$(dirname "$wrapper")"
  cat > "$wrapper" <<'WRAP'
#!/usr/bin/env bash
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
STORE="$ROOT/.git/ci-bisect/ci-bisect.sh"
exec bash "$STORE" "$@"
WRAP
  chmod +x "$wrapper" 2>/dev/null || true

  git config alias.ci-bisect '!f() { ROOT=$(git rev-parse --show-toplevel); bash "$ROOT/.git/ci-bisect/ci-bisect" "$@"; }; f' 2>/dev/null || true
}

# Ensure a stable invoker exists regardless of historical checkout state
ensure_stable_invoker() {
  mkdir -p "$REPO_ROOT/.git/ci-bisect"
  local wrapper="$REPO_ROOT/.git/ci-bisect/ci-bisect"
  cat > "$wrapper" <<'WRAP'
#!/usr/bin/env bash
set -euo pipefail
repo_root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
exec bash "$repo_root/.git/ci-bisect/ci-bisect.sh" "$@"
WRAP
  chmod +x "$wrapper" 2>/dev/null || true
  # Configure a git alias for easy invocation from any revision
  git config alias.ci-bisect '!f() { ROOT=$(git rev-parse --show-toplevel); bash "$ROOT/.git/ci-bisect/ci-bisect" "$@"; }; f' 2>/dev/null || true
}

ensure_stable_invoker

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

# Option: Only evaluate PR-related commits (classic GH merge or squashed PR merge)
PR_MERGES_ONLY=${BISect_PR_MERGES_ONLY:-0}

is_pr_merge_commit() {
  local sha=${1:-HEAD}
  local subj parents nparents
  subj=$(git show -s --format=%s "$sha" 2>/dev/null || true)
  parents=$(git show -s --format=%P "$sha" 2>/dev/null || true)
  if [[ -n "$parents" ]]; then
    nparents=$(wc -w <<<"$parents")
  else
    nparents=0
  fi
  # Heuristic 1: true GH merge commit (2+ parents + standard subject)
  if [[ $nparents -ge 2 && "$subj" == Merge\ pull\ request\ * ]]; then
    return 0
  fi
  # Heuristic 2: squashed PR merge (single parent, subject ends with "(#<number>)")
  if [[ $nparents -eq 1 && "$subj" =~ \(#([0-9]+)\)$ ]]; then
    return 0
  fi
  return 1
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

# Optional: use GitHub CLI to detect PR association (covers rebase merges)
USE_GH=${BISect_USE_GH:-0}

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
  # Ensure the stable invoker exists even if overlays are disabled.
  install_stable_invoker
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

# Detect whether a bisect session is currently active
bisect_active() {
  git rev-parse -q --verify BISECT_HEAD >/dev/null 2>&1
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
  # Ensure stable invoker exists so later steps can use .git/ci-bisect/ci-bisect or `git ci-bisect`
  install_stable_invoker
  overlay_capture
  echo "Starting bisect: good=$good bad=$bad"
  git bisect reset || true
  git bisect start "$bad" "$good"
  # If restricting to PR merges only and current candidate isn't a merge, advance until it is
  if [[ "$PR_MERGES_ONLY" == "1" ]]; then
    while git rev-parse -q --verify HEAD >/dev/null && ! is_pr_merge_commit HEAD; do
      desc=$(classify_commit HEAD 2>/dev/null || true)
      if ! git bisect skip; then
        cmd_classify_final || true
        break
      fi
    done
  fi
  push_current
  echo "Tip: If this script disappears on historical checkouts, run: .git/ci-bisect/ci-bisect step <good|bad|skip> (or 'git ci-bisect step <...>')"
}

cmd_step() {
  local verdict=${1:?"Provide one of: good|bad|skip"}
  # Re-install stable invoker in case we came from a revision that lacked it
  install_stable_invoker
  # Attribute verdict to the actual tested commit (parent of our marker if present)
  local tested
  tested=$(tested_sha)
  # If restricting to PR merges only, auto-skip non-merge candidates before applying a verdict
  if [[ "$PR_MERGES_ONLY" == "1" ]]; then
    if ! is_pr_merge_commit "$tested"; then
      echo "--merges-only: skipping candidate $(classify_commit "$tested" 2>/dev/null || echo $(git rev-parse --short=12 "$tested")) before verdict"
      if ! git bisect skip "$tested"; then
        cmd_classify_final || true
        # No further push; bisect ended. Reseed logic below will handle next steps.
        :
      fi
      # After skipping, bisect will check out the next candidate.
      if git rev-parse -q --verify HEAD >/dev/null; then
        push_current
      fi
      return 0
    fi
  fi
  case "$verdict" in
  # git bisect may exit non-zero when only skipped commits remain or when it concludes;
  # do not abort the script (set -e) so we can run our automatic finalize/reseed logic.
  good) git bisect good "$tested" || true;;
  bad)  git bisect bad  "$tested" || true;;
  skip) git bisect skip "$tested" || true;;
    *) echo "Unknown: $verdict"; exit 2;;
  esac
  # After stepping, bisect will check out the next candidate (HEAD may be absent when only skips remain).
  if ! git rev-parse -q --verify HEAD >/dev/null; then
    echo "Bisect ended without a checkout (only skipped commits likely)."
    cmd_classify_final || true
    echo "Review the decorated candidates above. You can now:"
    echo "  - Test a specific commit:   ./scripts/ci-bisect.sh test <sha>"
    echo "  - Rerun bisect without merges-only in this range."
    return 0
  fi
  if git rev-parse -q --verify HEAD >/dev/null; then
    # Enforce --merges-only post-advance as well: skip forward until HEAD is a PR merge
    if [[ "$PR_MERGES_ONLY" == "1" ]]; then
      while git rev-parse -q --verify HEAD >/dev/null && ! is_pr_merge_commit HEAD; do
        desc=$(classify_commit HEAD 2>/dev/null || true)
        if [[ -n "${desc:-}" ]]; then
          echo "--merges-only: skipping candidate ${desc} after verdict"
        else
          echo "--merges-only: skipping non-merge candidate $(git rev-parse --short=12 HEAD) after verdict"
        fi
        git bisect skip
      done
    fi
    if bisect_active; then
      push_current
    else
      # Bisect has concluded (often due to only skipped commits). Automatically reseed a new bisect
      # using the most recent good/bad bounds gleaned from the bisect log, and continue.
      # Also print a decorated classification of the final candidate set for quick inspection.
      cmd_classify_final || true
      echo "Bisect ended (likely only skipped commits left). Attempting to reseed with latest good/bad bounds..."
      local good_bound bad_bound
      good_bound=$(bisect_log_last_good); bad_bound=$(bisect_log_last_bad)
      if [[ -z "$good_bound" ]]; then good_bound=$(bisect_log_start_good); fi
      if [[ -z "$bad_bound" ]]; then bad_bound=$(bisect_log_start_bad); fi
      if [[ -n "$good_bound" && -n "$bad_bound" ]]; then
        echo "Reseeding: good=$good_bound bad=$bad_bound"
        git bisect reset || true
        git bisect start "$bad_bound" "$good_bound"
        if [[ "$PR_MERGES_ONLY" == "1" ]]; then
          while ! is_pr_merge_commit HEAD; do
            desc=$(classify_commit HEAD 2>/dev/null || true)
            if [[ -n "${desc:-}" ]]; then
              echo "--merges-only: reseed skipping candidate ${desc}"
            else
              echo "--merges-only: reseed skipping non-merge candidate $(git rev-parse --short=12 HEAD)"
            fi
            git bisect skip
            git rev-parse -q --verify HEAD >/dev/null || break
          done
        fi
        if git rev-parse -q --verify HEAD >/dev/null; then
          echo "Reseed complete. Next candidate is at $(git rev-parse --short=12 HEAD)."
          echo "No push performed on reseed to keep one-CI-push-per-step. Run 'step good|bad|skip' next."
        else
          echo "Reseed found no candidates."
        fi
      else
        echo "Could not determine bounds to reseed."
        # Decorate full final candidate set before aborting, while log is available
        cmd_classify_final || true
        echo "Auto-aborting to restore state."
        git bisect reset || true
      fi
    fi
  fi
  echo "Tip: If this script disappears on historical checkouts, run: .git/ci-bisect/ci-bisect step <good|bad|skip> (or 'git ci-bisect step <...>')"
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

# Classify a commit's PR provenance with offline heuristics and optional gh lookup
classify_commit() {
  local sha=${1:-HEAD}
  local subj parents nparents pr_nums="" kind="none"
  subj=$(git show -s --format=%s "$sha" 2>/dev/null || true)
  parents=$(git show -s --format=%P "$sha" 2>/dev/null || true)
  if [[ -n "$parents" ]]; then
    nparents=$(wc -w <<<"$parents")
  else
    nparents=0
  fi
  if [[ $nparents -ge 2 && "$subj" == Merge\ pull\ request\ * ]]; then
    kind="classic-merge"
    if [[ "$subj" =~ \#([0-9]+) ]]; then pr_nums=${BASH_REMATCH[1]}; fi
  elif [[ $nparents -eq 1 && "$subj" =~ \(#([0-9]+)\)$ ]]; then
    kind="squash-merge"; pr_nums=${BASH_REMATCH[1]}
  elif [[ "$USE_GH" == "1" ]] && command -v gh >/dev/null 2>&1; then
    pr_nums=$(gh api "repos/${OWNER}/${REPO}/commits/${sha}/pulls" --jq '.[].number' 2>/dev/null | paste -sd, -)
    if [[ -n "$pr_nums" ]]; then kind="gh-associated"; fi
  fi
  local short
  short=$(git rev-parse --short=12 "$sha" 2>/dev/null || echo "$sha")
  if [[ -n "$pr_nums" ]]; then
    echo "$short  $kind (PR #$pr_nums)"
  else
    if [[ "$kind" == "none" ]]; then
      echo "$short"
    else
      echo "$short  $kind"
    fi
  fi
}

cmd_classify() {
  if [[ $# -lt 1 ]]; then
    echo "Usage: $0 classify <sha...>" >&2; return 2
  fi
  for s in "$@"; do
    classify_commit "$s"
  done
}

cmd_classify_skipped() {
  local skipped
  # Avoid pipefail abort if 'git bisect log' fails (no session). Capture then process.
  local bisect_log
  bisect_log=$(git bisect log 2>/dev/null || true)
  skipped=$(printf "%s\n" "$bisect_log" | awk '/git bisect skip/ {print $NF}' | sort -u)
  if [[ -z "$skipped" ]]; then
    echo "No skipped commits found in bisect log."; return 0
  fi
  echo "Classifying skipped commits (USE_GH=$USE_GH):"
  # shellcheck disable=SC2086
  cmd_classify $skipped
}

# Collect and classify the final candidate set (skipped + bad bound)
collect_final_candidates() {
  local bisect_log skipped bad_bound
  bisect_log=$(git bisect log 2>/dev/null || true)
  skipped=$(printf "%s\n" "$bisect_log" | awk '/git bisect skip/ {print $NF}')
  bad_bound=$(printf "%s\n" "$bisect_log" | awk '/^git bisect start/ {gsub(/[\047\[\]]/, "", $4); print $4; exit}')
  if [[ -n "$skipped" ]]; then
    printf "%s\n" $skipped
  fi
  if [[ -n "$bad_bound" ]]; then
    printf "%s\n" "$bad_bound"
  fi
}

cmd_classify_final() {
  local list
  list=$(collect_final_candidates | awk 'NF>0' | sort -u)
  if [[ -z "$list" ]]; then
    echo "No final candidates found in bisect log."; return 0
  fi
  # shellcheck disable=SC2086
  cmd_classify $list
}

# Helpers to read bounds from `git bisect log`
bisect_log_start_bad() {
  git bisect log 2>/dev/null | awk '/^git bisect start/ {gsub(/[\047\[\]]/, "", $4); print $4; exit}'
}

bisect_log_start_good() {
  git bisect log 2>/dev/null | awk '/^git bisect start/ {gsub(/[\047\[\]]/, "", $5); print $5; exit}'
}

bisect_log_last_good() {
  git bisect log 2>/dev/null | awk '/^git bisect good/ {gsub(/[\047\[\]]/, "", $4); print $4}' | tail -n1
}

bisect_log_last_bad() {
  git bisect log 2>/dev/null | awk '/^git bisect bad/ {gsub(/[\047\[\]]/, "", $4); print $4}' | tail -n1
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
  start|step|status|abort|refresh-overlay|test|classify|classify-skipped|classify-final)
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
  classify) shift; cmd_classify "$@";;
  classify-skipped) shift; cmd_classify_skipped;;
  classify-final) shift; cmd_classify_final;;
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
  - Bisect step branches: "${BISect_BRANCH:-ci-bisect}-<shortsha>".
  - Direct test branches:  "${BISect_TEST_BRANCH_PREFIX:-ci-test}-<shortsha>".

Examples:
  BISect_COPY_CI=1 ./scripts/ci-bisect.sh start <good-sha> [bad-ref]
  ./scripts/ci-bisect.sh step good   # or bad/skip
  BISect_COPY_CI=1 ./scripts/ci-bisect.sh test <sha>
  BISect_COPY_CI=1 BISect_CI_PATHS=".github/workflows/ci.yaml packages/host/scripts/test-wait-for-servers.sh" \
    ./scripts/ci-bisect.sh start <good-sha>
  ./scripts/ci-bisect.sh --merges-only start <good-sha>
  ./scripts/ci-bisect.sh classify-skipped   # classify skipped commits at the end
  ./scripts/ci-bisect.sh classify-final     # classify final candidates at the end
  ./scripts/ci-bisect.sh classify <sha...>  # classify specific commits
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
  BISect_USE_GH=1 to consult gh for PR association (covers rebase merges)
Flags:
  --merges-only / --no-merges-only  Toggle PR merges only mode (persists in .git/ci-bisect/options)
Defaults:
  - PR merges only: OFF by default. When toggled via flags, the setting is saved and reused.
USAGE
     ;;
 esac

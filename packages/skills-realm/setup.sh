#!/usr/bin/env bash
#
# Put the skills realm's content on disk, and keep it current.
#
# The content is a separate repository, cardstack/boxel-skills, rather than
# anything committed here. It is deliberately not pinned to a revision: it is
# iterated on daily, and pinning would mean somebody moving a SHA every week to
# stay current. The cost is that realm content can change with no commit in
# this repository behind it — so a test or Percy snapshot that renders skills
# content can move on its own. Measured over twelve weeks that is roughly one
# Percy diff every three weeks on a single snapshot; the fix for that belongs
# in the tests that render third-party content, not here.
#
# (packages/boxel-cli/scripts/build-skills.ts does pin this same repository,
# to a released tag. That is a different job: the CLI ships those skills to
# users, so it needs to ship a known version.)
set -euo pipefail

SSH_URL="git@github.com:cardstack/boxel-skills.git"
HTTPS_URL="https://github.com/cardstack/boxel-skills.git"

cd "$(dirname "$0")"

clone() {
  # SSH first so contributors with a key use their credentials, HTTPS second
  # because the repository is public and CI has no key. The SSH attempt is
  # expected to fail wherever there is no key, so its output is dropped: left
  # visible it prints "Permission denied (publickey)" on every CI run, which
  # reads like the cause when you are scanning a log for a real failure.
  echo "Cloning boxel-skills ..."
  git clone --quiet "$SSH_URL" contents 2>/dev/null ||
    git clone --quiet "$HTTPS_URL" contents || {
      echo "both ssh and https clone of boxel-skills failed; check GitHub auth and network" >&2
      exit 1
    }
}

# Whether `contents` is the root of its own clone.
#
# Asking git whether it is *a* repository is not enough: `contents` sits inside
# this repository, so from an empty `contents/` git walks up and answers with
# the monorepo's worktree. The directory only holds skills content when the
# worktree root git reports is `contents` itself.
is_own_clone() {
  [ -d contents ] || return 1
  local top
  top=$(git -C contents rev-parse --show-toplevel 2>/dev/null) || return 1
  [ "$top" = "$(cd contents && pwd -P)" ]
}

if ! is_own_clone; then
  if [ -d contents ]; then
    # A `contents/` that exists without being a clone is the state the two
    # "Populate skills-realm content" steps in ci-host.yaml already work
    # around, so it does happen. Left alone it is the worst outcome available:
    # every check below reads as "nothing to do" and the caller is told setup
    # succeeded while the realm serves nothing.
    if [ -n "$(ls -A contents)" ]; then
      echo "packages/skills-realm/contents exists, holds files, and is not a boxel-skills clone." >&2
      echo "Move or delete it and re-run; refusing to delete files that aren't ours." >&2
      exit 1
    fi
    rmdir contents
  fi
  clone
  exit 0
fi

# An existing clone used to be left untouched forever, so a machine that had
# ever run this kept whatever content it first cloned — indefinitely, and
# silently, while CI clones fresh on every run and serves current skills.
#
# Somebody may be editing skills content in place to try something out, and
# updating over that would throw the work away without asking.
if [ -n "$(git -C contents status --porcelain)" ]; then
  echo "packages/skills-realm/contents has uncommitted changes; leaving it as it is." >&2
  echo "Commit or discard them and re-run \`pnpm skills:update\` to bring it up to date." >&2
  exit 0
fi

if ! git -C contents symbolic-ref --quiet HEAD >/dev/null 2>&1; then
  echo "packages/skills-realm/contents is not on a branch; leaving it as it is." >&2
  exit 0
fi

# Not fatal: this runs on the way into every dev stack, and being offline —
# or upstream being briefly unreachable — should cost you the update, not the
# ability to start. CI rarely reaches here; its checkouts have no `contents`
# yet, so they take the clone above.
if ! git -C contents pull --quiet --ff-only 2>/dev/null; then
  echo "Could not update skills content; continuing with what is on disk." >&2
  echo "Re-run \`pnpm skills:update\` once you are back online." >&2
fi

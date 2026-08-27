#!/usr/bin/env bash
#
# Put the skills realm's content on disk, and keep it current.
#
# The content is a separate repository, cardstack/boxel-skills, rather than
# anything committed here. It is deliberately not pinned to a revision: it is
# iterated on daily, and pinning would mean somebody moving a SHA every week to
# stay current. The cost of that is that realm content can change with no
# commit in this repository behind it — so a test or Percy snapshot that
# surfaces skills content can move on its own. Measured over twelve weeks that
# is roughly one Percy diff every three weeks on a single snapshot; the fix for
# that belongs in the tests that render third-party content, not here.
#
# (packages/boxel-cli/scripts/build-skills.ts does pin this same repository,
# to a released tag. That is a different job: the CLI ships those skills to
# users, so it needs to ship a known version.)
set -euo pipefail

SSH_URL="git@github.com:cardstack/boxel-skills.git"
HTTPS_URL="https://github.com/cardstack/boxel-skills.git"

cd "$(dirname "$0")"

if [ ! -d contents ]; then
  # SSH first so contributors with a key use their credentials, HTTPS second
  # because the repository is public and CI has no key. The SSH attempt is
  # expected to fail in CI, so its output is dropped: left visible it prints
  # "Permission denied (publickey)" on every run, which reads like a broken
  # build to anyone scanning a log for a real failure.
  echo "Cloning boxel-skills ..."
  git clone --quiet "$SSH_URL" contents 2>/dev/null ||
    git clone --quiet "$HTTPS_URL" contents || {
      echo "both ssh and https clone of boxel-skills failed; check GitHub auth and network" >&2
      exit 1
    }
  exit 0
fi

# An existing clone used to be left untouched forever, so a machine that had
# ever run this kept whatever content it first cloned — indefinitely, and
# silently. Fresh CI checkouts hid that; a developer's machine did not.
#
# Somebody may be editing skills content in place to try something out, and
# updating over that would throw the work away without asking.
if [ -n "$(git -C contents status --porcelain)" ]; then
  echo "packages/skills-realm/contents has uncommitted changes; leaving it as it is." >&2
  echo "Commit or discard them and re-run \`pnpm skills:update\` to bring it up to date." >&2
  exit 0
fi

branch=$(git -C contents symbolic-ref --quiet --short HEAD || true)
if [ -z "$branch" ]; then
  echo "packages/skills-realm/contents is not on a branch; leaving it as it is." >&2
  exit 0
fi

# Not fatal: this runs on the way into every dev stack, and being offline —
# or upstream being briefly unreachable — should cost you the update, not the
# ability to start. CI never reaches here anyway; its checkouts have no
# `contents` yet, so they take the clone above.
if ! git -C contents pull --quiet --ff-only 2>/dev/null; then
  echo "Could not update skills content; continuing with what is on disk." >&2
  echo "Re-run \`pnpm skills:update\` once you are back online." >&2
fi

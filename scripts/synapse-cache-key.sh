#!/bin/bash
# Prints the cache key identifying a migrated Synapse database, so a producer
# and a consumer agree on whether a baked database still describes this
# checkout's Synapse.
#
# The key is the identity of everything that decides what Synapse's schema and
# configuration are: its support tree, its docker helpers, and the pinned image
# tag. Anything else in the repo can change freely without invalidating a bake,
# which is the point — those inputs move about once a month against thousands
# of commits.
#
# Content is read through `git ls-files -s`, whose output is (mode, blob sha,
# stage, path) per tracked file, rather than by hashing files on disk: the
# support tree gains generated files (a signing key, a rendered homeserver.yaml)
# the first time Synapse boots, and hashing those would make the key depend on
# whether the caller had already run Synapse.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

{
  git ls-files -s packages/matrix/support/synapse packages/matrix/docker
  # The image tag matters most of all: a Synapse version bump can change the
  # schema, which is exactly when a baked database must not be reused.
  grep -o 'matrixdotorg/synapse:[^ ]*' .github/actions/warm-test-images/action.yml | sort -u
} | sha256sum | cut -c1-16

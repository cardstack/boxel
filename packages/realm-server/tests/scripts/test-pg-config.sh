#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

TEST_PG_CONTAINER="boxel-realm-test-pg"
# The Postgres image the suite runs on. The default has no pgvector, so the
# vector suites' pgvector tests pass as skipped; an image with pgvector (and
# unaccent), e.g. TEST_PG_IMAGE=postgres:16.3 where that build ships it, runs
# them. The seed is rebuilt when the image changes.
TEST_PG_IMAGE="${TEST_PG_IMAGE:-postgres:16.3-alpine}"
TEST_PG_PORT="55436"

TEST_PG_SEED_CONTAINER="boxel-realm-test-pg-seed-build"
TEST_PG_SEED_PORT="55435"
TEST_PG_SEED_DB="boxel_migrated"

TEST_PG_CACHE_DIR="${TESTS_DIR}/.test-pg-cache"
TEST_PG_SEED_TAR="${TEST_PG_CACHE_DIR}/boxel-realm-test-pgdata-seeded.tar"
TEST_PG_SEED_FINGERPRINT="${TEST_PG_CACHE_DIR}/boxel-realm-test-pgdata-seeded.fingerprint"

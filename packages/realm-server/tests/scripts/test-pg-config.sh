#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

TEST_PG_CONTAINER="boxel-realm-test-pg"
# The Postgres image the suite runs on: Postgres 16 with pgvector (and the
# contrib modules, unaccent among them), so the vector suites run their
# pgvector tests rather than skipping them. CI pulls it through the GHCR
# mirror (mirror-test-images.yml, warm-test-images). The seed is rebuilt when
# the image changes.
TEST_PG_IMAGE="${TEST_PG_IMAGE:-pgvector/pgvector:0.8.0-pg16}"
TEST_PG_PORT="55436"

TEST_PG_SEED_CONTAINER="boxel-realm-test-pg-seed-build"
TEST_PG_SEED_PORT="55435"
TEST_PG_SEED_DB="boxel_migrated"

TEST_PG_CACHE_DIR="${TESTS_DIR}/.test-pg-cache"
TEST_PG_SEED_TAR="${TEST_PG_CACHE_DIR}/boxel-realm-test-pgdata-seeded.tar"
TEST_PG_SEED_FINGERPRINT="${TEST_PG_CACHE_DIR}/boxel-realm-test-pgdata-seeded.fingerprint"

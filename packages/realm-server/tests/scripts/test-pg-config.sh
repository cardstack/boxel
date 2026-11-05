#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Postgres 16 with the pgvector extension, so the vector index tests run. The
# seed is built and booted in this one image; changing it changes the seed
# fingerprint (this file is part of it), so the seed is rebuilt.
TEST_PG_IMAGE="pgvector/pgvector:0.8.0-pg16"

TEST_PG_CONTAINER="boxel-realm-test-pg"
TEST_PG_PORT="55436"

TEST_PG_SEED_CONTAINER="boxel-realm-test-pg-seed-build"
TEST_PG_SEED_PORT="55435"
TEST_PG_SEED_DB="boxel_migrated"

TEST_PG_CACHE_DIR="${TESTS_DIR}/.test-pg-cache"
TEST_PG_SEED_TAR="${TEST_PG_CACHE_DIR}/boxel-realm-test-pgdata-seeded.tar"
TEST_PG_SEED_FINGERPRINT="${TEST_PG_CACHE_DIR}/boxel-realm-test-pgdata-seeded.fingerprint"

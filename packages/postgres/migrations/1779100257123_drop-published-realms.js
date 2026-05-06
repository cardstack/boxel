exports.shorthands = undefined;

// Phase 4 PR 2: drop the legacy `published_realms` table now that every
// reader (Phase 4 PR 1, CS-10896) and writer (this PR, CS-10897) is on
// `realm_registry`. The registry has carried the same data since the
// Phase 1 backfill (1776961234567_backfill-realm-registry.js).
//
// Down migration recreates the table structure but does NOT restore data.
// Rollback within the first 48 hours after deploy is structural-only; any
// republishes/unpublishes between deploy and rollback won't be reflected
// because handlers stop writing to `published_realms` in this PR.

exports.up = (pgm) => {
  pgm.dropIndex('published_realms', 'source_realm_url');
  pgm.dropIndex('published_realms', 'published_realm_url');
  pgm.dropTable('published_realms');
};

exports.down = (pgm) => {
  pgm.createTable('published_realms', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    owner_username: {
      type: 'varchar',
      notNull: true,
    },
    source_realm_url: {
      type: 'varchar',
      notNull: true,
    },
    published_realm_url: {
      type: 'varchar',
      notNull: true,
    },
    last_published_at: {
      type: 'bigint',
    },
  });
  pgm.createIndex('published_realms', 'source_realm_url');
  pgm.createIndex('published_realms', 'published_realm_url');
};

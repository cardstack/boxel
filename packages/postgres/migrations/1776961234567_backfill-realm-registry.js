exports.shorthands = undefined;

// One-shot backfill: copy every row from the legacy `published_realms` table
// into `realm_registry` with kind='published', pinned=false. Uses
// ON CONFLICT (url) DO NOTHING so the migration is a no-op on any url that
// already exists in the registry (e.g., if the boot-time upsert in
// packages/realm-server/lib/realm-registry-backfill.ts has already run against
// a deployment that predates this migration).
//
// Source realms and bootstrap realms are NOT backfilled here — they have no
// rows in the legacy table. The boot-time upsert handles those on every boot
// from disk scans and CLI args.

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO realm_registry (
      url,
      kind,
      disk_id,
      owner_username,
      source_url,
      last_published_at,
      pinned
    )
    SELECT
      published_realm_url,
      'published',
      id::text,
      owner_username,
      source_realm_url,
      last_published_at,
      false
    FROM published_realms
    ON CONFLICT (url) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  // Intentionally no-op. Reversing the backfill isn't safe: by the time we'd
  // roll this back, handlers or the boot-time upsert may have inserted new
  // rows or updated existing ones that pre-existed this migration. Let the
  // up-migration of realm_registry itself (dropping the whole table) be the
  // rollback mechanism if the whole registry needs to go away.
};

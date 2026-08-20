exports.shorthands = undefined;

// The MediaCache ledger: one row per derived-media capture (a screenshot of
// one source instance under one canonical capture spec at one generation),
// pointing at a content-addressed object (`object_key` = hash of the output
// bytes) in the configured media store. The ledger is the store's only
// catalog — GC reclaims objects by scanning these rows, never by enumerating
// the bucket — so every object write must be paired with a ledger row.
//
// Several rows may share one `object_key`: identical output bytes are stored
// once (dedupe-on-write) and the object is reclaimable only when its last
// referencing row is gone.
//
// `lane` separates GC policy: 'declared' rows (indexing-time declared
// screenshots) are superseded by newer generations of the same capture,
// while 'on-demand' rows (URL-DSL / POST captures) additionally age out by
// last access. `created_at` / `last_accessed_at` are unix-ms bigints like
// `prerendered_html.rendered_at` (pg returns them as JS strings).

exports.up = (pgm) => {
  pgm.createTable('media_cache_ledger', {
    realm_url: { type: 'varchar', notNull: true },
    source_url: { type: 'varchar', notNull: true },
    capture_spec_hash: { type: 'varchar', notNull: true },
    source_generation: { type: 'integer', notNull: true },
    object_key: { type: 'varchar', notNull: true },
    // The source file's content hash for captures keyed by file content
    // rather than by generation (FileDef posters); null otherwise.
    source_content_hash: { type: 'varchar' },
    lane: { type: 'varchar', notNull: true },
    content_type: { type: 'varchar', notNull: true },
    size_bytes: { type: 'bigint', notNull: true },
    created_at: { type: 'bigint', notNull: true },
    last_accessed_at: { type: 'bigint', notNull: true },
  });
  pgm.addConstraint('media_cache_ledger', 'media_cache_ledger_pkey', {
    primaryKey: [
      'realm_url',
      'source_url',
      'capture_spec_hash',
      'source_generation',
    ],
  });
  // Reference counting at GC time: is this object's key still referenced?
  pgm.createIndex('media_cache_ledger', ['object_key']);
  // The on-demand age-out lane scans by lane + last access.
  pgm.createIndex('media_cache_ledger', ['lane', 'last_accessed_at']);
};

exports.down = (pgm) => {
  pgm.dropTable('media_cache_ledger');
};

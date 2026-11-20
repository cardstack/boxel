// Indexes `boxel_index` rows by the prefix of their `url` within a realm, so a
// search a policy limits to some realm paths reads only the rows stored under
// them. A `query` grant whose `paths` name `blog/` scopes every search it
// admits with `url LIKE '<realm>/blog/%'`. Without this index Postgres reads
// every row of the realm and tests each one's URL, on every such search.
//
// The database's collation isn't `C`, so the primary key on `url` can't serve
// a `LIKE` prefix; `text_pattern_ops` compares byte by byte, which it can. The
// realm comes first because every search names exactly one.
//
// Only `boxel_index` is searched, so `boxel_index_pending` takes no index.
//
// The index is built CONCURRENTLY, outside a transaction, so building it
// doesn't block the index's writes. node-pg-migrate logs
// `#> WARNING: Need to break single transaction! <` when applying this
// migration; that is expected, not a failure. An interrupted CONCURRENTLY
// build leaves an INVALID index under the target name, so the CREATE is
// preceded by an unconditional DROP, and a retry rebuilds it.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS boxel_index_realm_url_prefix_idx`);
  pgm.sql(`
    CREATE INDEX CONCURRENTLY boxel_index_realm_url_prefix_idx
      ON boxel_index (realm_url, url text_pattern_ops)
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS boxel_index_realm_url_prefix_idx`);
};

exports.shorthands = undefined;

// The content hash of the source bytes each instance row's document was built
// from.
//
// The card+json GET reports this as `meta.version`, which a client sends back
// as the base its next write is computed against. The realm answers
// `baseMatched` by comparing that base to the bytes it executed from, so the
// value has to identify the bytes the served document came from and nothing
// else: a version naming newer bytes than the document beside it turns a
// client's honest "I cannot confirm this" into a false confirmation.
//
// That is why it lives here rather than being read from
// `realm_file_meta.content_hash` at serve time. Two reasons, either decisive.
// The served document is assembled from the index while that column describes
// whatever the file holds now, and `persistFileMeta` runs ahead of
// `performIndex` — so between a write and its index pass the two are different
// bytes. And that column has exactly one writer, the realm's own write path, so
// every file that reached disk another way (a deploy, an rsync onto the volume,
// a seeded base / catalog / skills realm, a test fixture) carries NULL there
// permanently; serving from it would put a full re-hash on every card+json GET
// for every card in a freshly deployed realm.
//
// Written by the pass that indexed the bytes, from the render's own read of
// them — the read whose result is serialized into `pristine_doc`. The worker's
// separate read of the same file is not that read.
//
// Instance rows only. A file row's content hash already rides inside its
// `pristine_doc` as the file-meta resource's `contentHash`.
//
// Nullable, with no default and no backfill. NULL means no pass has stamped the
// row yet, or the pass produced no document; the GET then reports no version,
// which is what it did before this column existed. Nothing decides row liveness
// from it.
//
// Adding a nullable column with no default is a catalog edit, so this is
// instant whatever the tables hold. No index: nothing queries by this value —
// it is read off a row already being fetched by primary key.
exports.up = (pgm) => {
  pgm.addColumn('boxel_index', {
    source_content_hash: { type: 'varchar' },
  });
  pgm.addColumn('boxel_index_working', {
    source_content_hash: { type: 'varchar' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('boxel_index', 'source_content_hash');
  pgm.dropColumn('boxel_index_working', 'source_content_hash');
};

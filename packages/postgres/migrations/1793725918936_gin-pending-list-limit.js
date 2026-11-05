// The containment lookups every incremental index runs (`deps @> '["url"]'`,
// `search_doc @> {...}`, `types @> ...`) are served by GIN indexes. With GIN's
// default `fastupdate`, new entries go to a pending list, and every lookup
// scans that list in full until something merges it into the index: the
// inserting backend once the list passes `gin_pending_list_limit` (4 MB by
// default), autoanalyze, or VACUUM. A lookup run right after a pass's commit
// can scan megabytes of unmerged entries: 601 probes of a freshly written
// 20,000-row index took 2,000 ms, against 0.8 ms once the list was merged.
//
// A 256 kB limit keeps the batched merge, so a commit doesn't pay to maintain
// the index row by row, and keeps each lookup's pending scan to 32 pages:
// measured on a copy of the dev index tables, 502 walk-shaped probes took
// 49-51 ms with it, 42-54 ms with `fastupdate` off, and 160-230 ms at the
// default limit, while a 6,477-row `boxel_index` swap took 1.45 s, 2.5 s and
// 1.25 s.
//
// `ALTER INDEX ... SET` takes an ACCESS EXCLUSIVE lock on the index, and every
// query of the table locks all of its indexes while it plans, so a statement
// waiting behind an open transaction queues every read and write of the
// table behind it. The additive phase runs while the previous release is
// serving and indexing. So each statement runs on its own, outside a
// transaction, under a lock timeout: a statement that can't get its lock fails
// the migration, which can be run again, since setting the option is
// idempotent.

const indexes = [
  'boxel_index_deps_index',
  'boxel_index_relationship_deps_index',
  'boxel_index_search_doc_index',
  'boxel_index_types_containment_idx',
  'prerendered_html_deps_index',
];

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`SET lock_timeout = '3s'`);
  for (let name of indexes) {
    pgm.sql(`ALTER INDEX ${name} SET (gin_pending_list_limit = 256)`);
  }
  pgm.sql(`RESET lock_timeout`);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`SET lock_timeout = '3s'`);
  for (let name of indexes) {
    pgm.sql(`ALTER INDEX ${name} RESET (gin_pending_list_limit)`);
  }
  pgm.sql(`RESET lock_timeout`);
};

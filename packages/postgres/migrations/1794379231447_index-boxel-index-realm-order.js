// Ordered indexes for a realm's plain pages: the newest, the oldest, or the
// default url order, a page at a time. A search with no facets and no
// fanned-out condition pages as an ordered LIMIT (`#plainTopN` in
// runtime-common's index-query-engine), and these let the planner read that
// page off the index and stop after it, instead of reading every row in the
// realm, sorting them all and keeping twenty. The single-column
// `last_modified` and `resource_created_at` indexes can't serve a page within
// one realm; the leading `realm_url` is what makes them usable.
//
// Each order's index matches the ORDER BY the engine writes: `DESC NULLS LAST`
// for the date sorts (their usual direction), and `url COLLATE "POSIX", type`
// for the default order and every sort's tiebreaker.
//
// CONCURRENTLY because an ordinary build blocks writes to boxel_index for its
// whole duration, and the previous revision is still indexing while this runs.
// It cannot run inside a transaction, hence noTransaction(). An interrupted
// CONCURRENTLY build leaves an INVALID index under the name, which
// `IF NOT EXISTS` would treat as done, so each CREATE follows an unconditional
// DROP and a retry rebuilds it.

exports.shorthands = undefined;

const INDEXES = [
  [
    'boxel_index_realm_last_modified_index',
    'boxel_index (realm_url, last_modified DESC NULLS LAST, url COLLATE "POSIX", type)',
  ],
  [
    'boxel_index_realm_created_at_index',
    'boxel_index (realm_url, resource_created_at DESC NULLS LAST, url COLLATE "POSIX", type)',
  ],
  [
    'boxel_index_realm_url_order_index',
    'boxel_index (realm_url, url COLLATE "POSIX", type)',
  ],
];

exports.up = (pgm) => {
  pgm.noTransaction();
  for (let [name, on] of INDEXES) {
    pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS ${name};`);
    pgm.sql(`CREATE INDEX CONCURRENTLY ${name} ON ${on};`);
  }
};

exports.down = (pgm) => {
  pgm.noTransaction();
  for (let [name] of INDEXES) {
    pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS ${name};`);
  }
};

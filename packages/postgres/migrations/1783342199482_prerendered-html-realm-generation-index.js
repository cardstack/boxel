exports.shorthands = undefined;

// The `_search` response cache key folds in each realm's current
// prerendered-HTML generation, read as `MAX(generation)` per `realm_url` on
// every cacheable (indexer/prerender-driven) request. A composite
// `(realm_url, generation)` btree lets that max resolve as a bounded index
// scan instead of aggregating every one of a realm's rows — the pre-existing
// `realm_url`-only index can't. Kept off the transient `_working` table, which
// the cache key never reads.

exports.up = (pgm) => {
  pgm.createIndex('prerendered_html', ['realm_url', 'generation']);
};

exports.down = (pgm) => {
  pgm.dropIndex('prerendered_html', ['realm_url', 'generation']);
};

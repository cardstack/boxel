exports.shorthands = undefined;

// The containment lookups that every incremental index runs
// (`deps @> '["url"]'`, `search_doc @> {...}`, `types @> ...`) are served by
// GIN indexes. With GIN's default `fastupdate`, inserts land in a pending
// list that is only folded into the index by VACUUM; under a write stream the
// list grows, the planner's cost for the index climbs past a sequential scan,
// and the lookup silently degrades (measured: 438 ms sequential vs 0.05 ms
// indexed on a 6k-row index table). Turning `fastupdate` off makes each
// insert maintain the index directly, so a lookup stays indexed no matter how
// long the stream runs. Entries already in a pending list stay there until
// the next VACUUM folds them in.
const indexes = [
  'boxel_index_deps_index',
  'boxel_index_relationship_deps_index',
  'boxel_index_search_doc_index',
  'boxel_index_types_containment_idx',
  'prerendered_html_deps_index',
];

exports.up = (pgm) => {
  pgm.sql(
    indexes
      .map((name) => `ALTER INDEX ${name} SET (fastupdate = off);`)
      .join('\n'),
  );
};

exports.down = (pgm) => {
  pgm.sql(
    indexes.map((name) => `ALTER INDEX ${name} RESET (fastupdate);`).join('\n'),
  );
};

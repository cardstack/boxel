// `jsonb_tree` was declared with Postgres's defaults, VOLATILE and PARALLEL
// UNSAFE, though it only reads: its rows depend on its arguments and on the
// spilled values `spill_unmark` looks up in `boxel_index_spill`. A volatile
// function is never inlined, and a parallel-unsafe one keeps the whole
// statement off parallel workers, so every list filter that walks the tree
// (a `not`, a range or a substring over a list) ran as an opaque function
// scan on one process.
//
// It is STABLE, not IMMUTABLE: reading a table, it answers the same within a
// statement but not across one that changes the spill. PARALLEL SAFE as
// `spill_unmark` is. Only the markings change; the body is the one
// 1794326957555 defined, untouched (ALTER FUNCTION keeps it).

exports.up = (pgm) => {
  pgm.sql(`ALTER FUNCTION jsonb_tree(JSONB, TEXT) STABLE PARALLEL SAFE;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER FUNCTION jsonb_tree(JSONB, TEXT) VOLATILE PARALLEL UNSAFE;`);
};

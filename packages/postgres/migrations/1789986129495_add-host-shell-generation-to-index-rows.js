exports.shorthands = undefined;

// Which host shell rendered each index row.
//
// `host_shell_generation` holds the ordering `host_shell_generation` (the
// singleton table) assigns to each shell the realm server observes. A row
// carrying a generation below the current one was rendered by a page running a
// host bundle that is no longer being served, which is the population a repair
// pass has to find. Reading that from `diagnostics` instead is not an option:
// it is `jsonb` with no index on its keys, and the predicate is a range scan
// over every row of the largest table in the schema.
//
// Nullable, with no default and no backfill. NULL means the row predates the
// stamp or was rendered by a prerender server that reported no generation, and
// that is genuinely unknown rather than old — a backfilled zero would read as
// "below current" and enlist every historical row in the first repair. The
// repair predicate is `host_shell_generation < current`, which excludes NULL
// by SQL's own semantics, so unknown rows stay out without a guard.
//
// Distinct from the existing `generation` column, which is the realm's own
// write counter. The two answer different questions and neither substitutes
// for the other: `generation` says when a row was written relative to its
// realm, `host_shell_generation` says which bundle rendered it.
//
// This column is a write stamp. Nothing that decides whether a row is live may
// read it — filtering row selection on a stamp hides live rows, which is the
// mistake `generation` already exists as a warning about.
exports.up = (pgm) => {
  pgm.addColumn('boxel_index', {
    host_shell_generation: { type: 'integer' },
  });
  pgm.addColumn('boxel_index_working', {
    host_shell_generation: { type: 'integer' },
  });

  // Partial, because the predicate never matches NULL and the unstamped rows
  // are the majority until a full pass has run against every realm. Indexing
  // them would size the index by the table rather than by the rows the repair
  // query can actually return.
  pgm.createIndex('boxel_index', 'host_shell_generation', {
    name: 'boxel_index_host_shell_generation_index',
    where: 'host_shell_generation IS NOT NULL',
  });
  pgm.createIndex('boxel_index_working', 'host_shell_generation', {
    name: 'boxel_index_working_host_shell_generation_index',
    where: 'host_shell_generation IS NOT NULL',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('boxel_index', 'host_shell_generation', {
    name: 'boxel_index_host_shell_generation_index',
  });
  pgm.dropIndex('boxel_index_working', 'host_shell_generation', {
    name: 'boxel_index_working_host_shell_generation_index',
  });
  pgm.dropColumn('boxel_index', 'host_shell_generation');
  pgm.dropColumn('boxel_index_working', 'host_shell_generation');
};

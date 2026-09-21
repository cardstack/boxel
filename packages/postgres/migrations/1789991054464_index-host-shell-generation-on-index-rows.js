// Indexes over `host_shell_generation`, so the repair query it exists for —
// every row below the shell now being served — is a range scan on an index
// rather than a sequential read of the largest table in the schema.
//
// Partial, because the predicate `host_shell_generation < current` never
// matches NULL and the unstamped rows are the majority until a full pass has
// run against every realm. Indexing them would size the index by the table
// rather than by the rows the query can actually return.
//
// CONCURRENTLY because an ordinary build takes a lock that blocks writes for
// its whole duration, and `boxel_index` is both the largest table here and one
// the previous revision is still writing to while this runs — the additive
// phase applies before the new code is deployed. It cannot run inside a
// transaction, hence noTransaction(). node-pg-migrate logs
// `#> WARNING: Need to break single transaction! <` when applying this
// migration; that is expected, not a failure.
//
// Separate from the migration that adds the columns so a build that is
// interrupted does not take the column with it on retry. Adding a nullable
// column with no default is a catalog edit and is instant; this is the part
// whose cost scales with the table.
//
// An interrupted CONCURRENTLY build — the gated migration task is bounded and
// stopped on timeout, so a slow build can be killed mid-flight — leaves an
// INVALID index under the target name, which the planner ignores. `IF NOT
// EXISTS` matches on relation name alone and would treat that leftover as
// done, so the index would carry write overhead forever while serving no read.
// Each CREATE is therefore preceded by an unconditional DROP, making retries
// self-healing.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS boxel_index_host_shell_generation_index;`,
  );
  pgm.sql(`
    CREATE INDEX CONCURRENTLY boxel_index_host_shell_generation_index
      ON boxel_index (host_shell_generation)
      WHERE host_shell_generation IS NOT NULL;
  `);
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS boxel_index_working_host_shell_generation_index;`,
  );
  pgm.sql(`
    CREATE INDEX CONCURRENTLY boxel_index_working_host_shell_generation_index
      ON boxel_index_working (host_shell_generation)
      WHERE host_shell_generation IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS boxel_index_host_shell_generation_index;`,
  );
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS boxel_index_working_host_shell_generation_index;`,
  );
};

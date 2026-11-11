// Vacuum, analyze and planner statistics for the tables a search reads, set on
// the tables themselves so every environment gets them (no role or server
// setting to keep in step).
//
// Autovacuum. Postgres's defaults wait until a fifth of a table's rows are
// dead (`autovacuum_vacuum_scale_factor` 0.2) and a tenth have changed
// (`autovacuum_analyze_scale_factor` 0.1). An index pass rewrites a realm's
// rows in place, so on a large `boxel_index` that is hundreds of thousands
// of dead tuples sitting in the GIN indexes' posting lists before a vacuum
// comes, and a realm's new cards stay out of the statistics until an analyze
// does. The search tables vacuum at 5% dead and analyze at 2% changed, with
// a floor so a small table isn't vacuumed for every few rows. The
// insert-driven threshold (`autovacuum_vacuum_insert_scale_factor`) matters
// for the append-only log lines: without a vacuum the visibility map stays
// unset and an index-only read of them visits the heap anyway.
//
// Statistics. The planner estimates a realm's rows from `realm_url`'s most
// common values, 100 of them by default: with more realms than that, every
// realm outside the top hundred is guessed at an average, a small realm is
// guessed large and a large one small. A target of 1,000 keeps the realms an
// installation actually has. `type` and `types` get the same, and extended
// statistics on (realm_url, type) tell the planner how the two go together
// (a realm's share of file rows differs from realm to realm), which the
// per-column statistics assume are independent. The new statistics are
// gathered by the next analyze (autovacuum's, under the thresholds above).
//
// Log line partitions are made per realm as logs arrive
// (log-line-partitions.ts); the settings are set here on the partitions that
// exist, and a partition made later takes Postgres's defaults until it is
// given them.

const SEARCH_TABLES = [
  'boxel_index',
  'prerendered_html',
  'boxel_index_passages',
  'boxel_index_words',
];

const VACUUM = `autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 500, autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 500, autovacuum_vacuum_insert_scale_factor = 0.05`;
const VACUUM_KEYS = `autovacuum_vacuum_scale_factor, autovacuum_vacuum_threshold, autovacuum_analyze_scale_factor, autovacuum_analyze_threshold, autovacuum_vacuum_insert_scale_factor`;

// Each leaf partition of the log lines (a partitioned table holds no storage
// parameters of its own), when the table exists.
const forEachLogPartition = (statement) => `
  DO $$
  DECLARE part regclass;
  BEGIN
    IF to_regclass('boxel_log_lines') IS NULL THEN RETURN; END IF;
    FOR part IN
      SELECT c.oid::regclass FROM pg_partition_tree('boxel_log_lines') AS t
        JOIN pg_class AS c ON c.oid = t.relid
       WHERE t.isleaf
    LOOP
      EXECUTE format(${statement}, part);
    END LOOP;
  END $$;
`;

exports.up = (pgm) => {
  for (let table of SEARCH_TABLES) {
    pgm.sql(`ALTER TABLE ${table} SET (${VACUUM});`);
  }
  pgm.sql(forEachLogPartition(`'ALTER TABLE %s SET (${VACUUM})'`));
  pgm.sql(`
    ALTER TABLE boxel_index
      ALTER COLUMN realm_url SET STATISTICS 1000,
      ALTER COLUMN type SET STATISTICS 1000,
      ALTER COLUMN types SET STATISTICS 1000;
    CREATE STATISTICS IF NOT EXISTS boxel_index_realm_type_stats
      (ndistinct, dependencies, mcv) ON realm_url, type FROM boxel_index;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP STATISTICS IF EXISTS boxel_index_realm_type_stats;
    ALTER TABLE boxel_index
      ALTER COLUMN realm_url SET STATISTICS -1,
      ALTER COLUMN type SET STATISTICS -1,
      ALTER COLUMN types SET STATISTICS -1;
  `);
  pgm.sql(forEachLogPartition(`'ALTER TABLE %s RESET (${VACUUM_KEYS})'`));
  for (let table of SEARCH_TABLES) {
    pgm.sql(`ALTER TABLE ${table} RESET (${VACUUM_KEYS});`);
  }
};

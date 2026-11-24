// The indexes the engine's pages read (the prerendered HTML file alias and render errors, a realm's ordered pages) and the search tables' vacuum and statistics settings.
//
// One migration for this structure: the steps below are the migrations it
// was built from, in their order, each kept whole with its own
// notes. Each step's up runs in order and its down in reverse. A step that
// builds an index CONCURRENTLY calls noTransaction(), so the migration runs
// outside one transaction, as those steps did on their own.

exports.shorthands = undefined;

// ---- 1794379110721_index-prerendered-html-file-alias.js ----
const step1 = (() => {
  const exports = {};
  // An index on `prerendered_html (realm_url, file_alias)`, for the lookup each
  // render visit makes of its card's prior capture state (`priorCaptureStates`
  // in runtime-common's index-writer), which reads a row by its URL or by its
  // file alias. The URL branch is served by the primary key; nothing served the
  // alias branch, so Postgres scanned the whole table on every visit.
  //
  // CONCURRENTLY because an ordinary build blocks writes to the table for its
  // whole duration, and the previous revision is still writing renders while
  // this runs. It cannot run inside a transaction, hence noTransaction(). An
  // interrupted CONCURRENTLY build leaves an INVALID index under the name, which
  // `IF NOT EXISTS` would treat as done, so the CREATE follows an unconditional
  // DROP and a retry rebuilds it.

  exports.up = (pgm) => {
    pgm.noTransaction();
    pgm.sql(
      `DROP INDEX CONCURRENTLY IF EXISTS prerendered_html_realm_file_alias_index;`,
    );
    pgm.sql(`
    CREATE INDEX CONCURRENTLY prerendered_html_realm_file_alias_index
      ON prerendered_html (realm_url, file_alias);
  `);
  };

  exports.down = (pgm) => {
    pgm.noTransaction();
    pgm.sql(
      `DROP INDEX CONCURRENTLY IF EXISTS prerendered_html_realm_file_alias_index;`,
    );
  };
  return exports;
})();

// ---- 1794379231447_index-boxel-index-realm-order.js ----
const step2 = (() => {
  const exports = {};
  // Ordered indexes for a realm's plain pages: the newest, the oldest, or the
  // default url order, a page at a time. A search with no
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
  return exports;
})();

// ---- 1794379233132_index-prerendered-html-render-errors.js ----
const step3 = (() => {
  const exports = {};
  // A partial index of the prerendered_html rows that hold a render error. A
  // search's "not errored" test asks, per candidate row, whether a current
  // render error exists (`notEffectivelyErrored` in runtime-common's
  // index-query-engine), as a NOT EXISTS this index answers. Few rows ever hold
  // an error, so the index stays small and cached, and a query that tests
  // thousands of candidates no longer reads each one's prerendered row.
  //
  // CONCURRENTLY because an ordinary build blocks writes to the table for its
  // whole duration, and the previous revision is still writing renders while
  // this runs. It cannot run inside a transaction, hence noTransaction(). An
  // interrupted CONCURRENTLY build leaves an INVALID index under the name, which
  // `IF NOT EXISTS` would treat as done, so the CREATE follows an unconditional
  // DROP and a retry rebuilds it.

  exports.up = (pgm) => {
    pgm.noTransaction();
    pgm.sql(
      `DROP INDEX CONCURRENTLY IF EXISTS prerendered_html_render_error_index;`,
    );
    pgm.sql(`
    CREATE INDEX CONCURRENTLY prerendered_html_render_error_index
      ON prerendered_html (url, realm_url, type, generation)
      WHERE error_doc IS NOT NULL;
  `);
  };

  exports.down = (pgm) => {
    pgm.noTransaction();
    pgm.sql(
      `DROP INDEX CONCURRENTLY IF EXISTS prerendered_html_render_error_index;`,
    );
  };
  return exports;
})();

// ---- 1794379443002_search-tables-vacuum-and-statistics.js ----
const step4 = (() => {
  const exports = {};
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
  // a floor so a small table isn't vacuumed for every few rows.
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

  // Compression. A search doc over about 2 KB is stored out of line (TOAST),
  // and a read of any key decompresses the whole doc. lz4 decompresses several
  // times faster than Postgres's default pglz, at a similar size. It applies to
  // values written from now on (an index pass rewrites a realm's rows). Only a
  // server built with lz4 (Postgres 14+) lists it for
  // `default_toast_compression`; elsewhere the docs keep pglz.

  // A search table added later sets the same autovacuum settings in the
  // migration that creates it.
  const SEARCH_TABLES = ['boxel_index', 'prerendered_html'];

  const VACUUM = `autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 500, autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 500, autovacuum_vacuum_insert_scale_factor = 0.05`;
  const VACUUM_KEYS = `autovacuum_vacuum_scale_factor, autovacuum_vacuum_threshold, autovacuum_analyze_scale_factor, autovacuum_analyze_threshold, autovacuum_vacuum_insert_scale_factor`;

  exports.up = (pgm) => {
    for (let table of SEARCH_TABLES) {
      pgm.sql(`ALTER TABLE ${table} SET (${VACUUM});`);
    }
    pgm.sql(`
    ALTER TABLE boxel_index
      ALTER COLUMN realm_url SET STATISTICS 1000,
      ALTER COLUMN type SET STATISTICS 1000,
      ALTER COLUMN types SET STATISTICS 1000;
    CREATE STATISTICS IF NOT EXISTS boxel_index_realm_type_stats
      (ndistinct, dependencies, mcv) ON realm_url, type FROM boxel_index;
  `);
    pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_settings
        WHERE name = 'default_toast_compression' AND 'lz4' = ANY(enumvals)
      ) THEN
        ALTER TABLE boxel_index ALTER COLUMN search_doc SET COMPRESSION lz4;
        ALTER TABLE boxel_index_pending ALTER COLUMN search_doc SET COMPRESSION lz4;
      END IF;
    END
    $$;
  `);
  };

  exports.down = (pgm) => {
    pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_settings
        WHERE name = 'default_toast_compression' AND 'lz4' = ANY(enumvals)
      ) THEN
        ALTER TABLE boxel_index ALTER COLUMN search_doc SET COMPRESSION DEFAULT;
        ALTER TABLE boxel_index_pending ALTER COLUMN search_doc SET COMPRESSION DEFAULT;
      END IF;
    END
    $$;
  `);
    pgm.sql(`
    DROP STATISTICS IF EXISTS boxel_index_realm_type_stats;
    ALTER TABLE boxel_index
      ALTER COLUMN realm_url SET STATISTICS -1,
      ALTER COLUMN type SET STATISTICS -1,
      ALTER COLUMN types SET STATISTICS -1;
  `);
    for (let table of SEARCH_TABLES) {
      pgm.sql(`ALTER TABLE ${table} RESET (${VACUUM_KEYS});`);
    }
  };
  return exports;
})();

const steps = [step1, step2, step3, step4];

exports.up = async (pgm) => {
  for (let step of steps) await step.up(pgm);
};

exports.down = async (pgm) => {
  for (let step of [...steps].reverse()) await step.down(pgm);
};

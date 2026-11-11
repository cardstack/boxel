// The lines of a realm's append-only logs (`.jsonl` and `.log` files), one
// row each, so a query can filter, sort and count a subset of a log without
// reading the file.
//
// A log is written one line at a time (the `appendLine` operation), and its
// file meta keeps only a tail of recent lines (`contentTailBytes`). These
// rows are the queryable form, kept at the cost of what was appended
// (`log-line-index.ts` in runtime-common): the realm writes an append's rows
// as it lands, and an index pass reads only the bytes past what is indexed.
//
// - `entry` is the line parsed as JSON. A JSON string under `what` that
//   holds an object or a list is decoded to its value, so a query reaches
//   `what.action` rather than matching inside a string. A `.log` line, or a
//   line that isn't JSON, is `{ "text": <line> }`, with `at` and `actor` read
//   from the line where LogFile's `record` wrote them.
// - `at` is the entry's time, for range filters and the default order.
//
// `boxel_log_lines` is partitioned by realm (LIST on `realm_url`): every
// statement names the realm it reads or writes, so it touches one realm's
// partition, and deleting a realm drops its partition. `boxel_log_realms`
// records each realm's partition: a readable prefix of its URL and a hash of
// the whole URL. The engine creates a realm's partition the first time it
// writes a line there (runtime-common/log-line-partitions.ts, under an
// advisory lock); rows of a realm with no partition yet land in the DEFAULT
// partition, and are moved into the realm's partition when it is created.
// Every partition carries the parent's indexes: the key `(realm_url, url,
// line_no)`, `(url, at)` for time ranges and order, a GIN over `entry` for
// `eq` and `in`, `(url, actor, line_no)` for a search a realm policy scopes
// to the caller's own lines, and `(url, at DESC NULLS LAST, line_no)` so a
// newest-first page of a log is an ordered index scan.
//
// `boxel_log_files` holds one row per log (its line count, the byte offset
// past its last indexed line, a running hash, and the last line's length and
// md5) and stays one table, indexed by realm.
//
// Written to run again safely, and over the tables this migration made under
// its earlier number (1794293714555), which were not partitioned: their rows
// are moved into the partitioned table, each realm's into its own partition.
//
// Postgres only: the host's SQLite schema leaves these tables out
// (scripts/schema-dump.sh), and the log query refuses SQLite.

exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    DECLARE
      r record;
      part text;
      flat boolean;
    BEGIN
      CREATE TABLE IF NOT EXISTS boxel_log_realms (
        realm_url TEXT PRIMARY KEY,
        partition_name TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- Evaluated in two steps: a cast of a name with no table fails.
      flat := false;
      IF to_regclass('boxel_log_lines') IS NOT NULL THEN
        flat := NOT EXISTS (
          SELECT 1 FROM pg_partitioned_table
           WHERE partrelid = to_regclass('boxel_log_lines')
        );
      END IF;
      IF flat THEN
        LOCK TABLE boxel_log_lines IN SHARE MODE;
        ALTER TABLE boxel_log_lines RENAME TO boxel_log_lines_flat;
        ALTER TABLE boxel_log_lines_flat
          RENAME CONSTRAINT boxel_log_lines_pkey TO boxel_log_lines_flat_pkey;
        DROP INDEX IF EXISTS boxel_log_lines_at_idx;
        DROP INDEX IF EXISTS boxel_log_lines_entry_idx;
        DROP INDEX IF EXISTS boxel_log_lines_actor_idx;
        DROP INDEX IF EXISTS boxel_log_lines_realm_url_idx;
        DROP INDEX IF EXISTS boxel_log_lines_newest_idx;
      END IF;

      CREATE TABLE IF NOT EXISTS boxel_log_lines (
        realm_url TEXT NOT NULL,
        url TEXT NOT NULL,
        line_no INTEGER NOT NULL,
        at TIMESTAMPTZ,
        actor TEXT,
        entry JSONB NOT NULL,
        CONSTRAINT boxel_log_lines_pkey PRIMARY KEY (realm_url, url, line_no)
      ) PARTITION BY LIST (realm_url);
      CREATE TABLE IF NOT EXISTS boxel_log_lines_default
        PARTITION OF boxel_log_lines DEFAULT;
      CREATE INDEX IF NOT EXISTS boxel_log_lines_at_idx
        ON boxel_log_lines (url, at);
      CREATE INDEX IF NOT EXISTS boxel_log_lines_entry_idx
        ON boxel_log_lines USING gin (entry jsonb_path_ops);
      CREATE INDEX IF NOT EXISTS boxel_log_lines_actor_idx
        ON boxel_log_lines (url, actor, line_no);
      CREATE INDEX IF NOT EXISTS boxel_log_lines_newest_idx
        ON boxel_log_lines (url, at DESC NULLS LAST, line_no);

      IF flat THEN
        FOR r IN SELECT DISTINCT realm_url FROM boxel_log_lines_flat LOOP
          -- the same name runtime-common/log-line-partitions.ts gives a realm
          part := 'boxel_log_lines_'
            || left(coalesce(nullif(trim(both '_' FROM regexp_replace(
                 lower(regexp_replace(r.realm_url, '^[a-z]+://', '')),
                 '[^a-z0-9]+', '_', 'g')), ''), 'realm'), 24)
            || '_' || left(md5(r.realm_url), 8);
          IF NOT EXISTS (
            SELECT 1 FROM boxel_log_realms WHERE realm_url = r.realm_url
          ) THEN
            EXECUTE format(
              'CREATE TABLE %I PARTITION OF boxel_log_lines FOR VALUES IN (%L)',
              part, r.realm_url
            );
            -- as runtime-common/log-line-partitions.ts sets a new one's
            EXECUTE format(
              'ALTER TABLE %I SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 500, autovacuum_analyze_scale_factor = 0.02, autovacuum_analyze_threshold = 500, autovacuum_vacuum_insert_scale_factor = 0.05)',
              part
            );
            INSERT INTO boxel_log_realms (realm_url, partition_name)
              VALUES (r.realm_url, part);
          END IF;
        END LOOP;
        INSERT INTO boxel_log_lines (realm_url, url, line_no, at, actor, entry)
          SELECT realm_url, url, line_no, at, actor, entry
            FROM boxel_log_lines_flat
          ON CONFLICT DO NOTHING;
        DROP TABLE boxel_log_lines_flat;
      END IF;

      CREATE TABLE IF NOT EXISTS boxel_log_files (
        url TEXT NOT NULL PRIMARY KEY,
        realm_url TEXT NOT NULL,
        line_count INTEGER NOT NULL,
        prefix_length BIGINT,
        prefix_hash TEXT,
        last_line_length INTEGER,
        last_line_hash TEXT
      );
      ALTER TABLE boxel_log_files ADD COLUMN IF NOT EXISTS prefix_length BIGINT;
      ALTER TABLE boxel_log_files ADD COLUMN IF NOT EXISTS prefix_hash TEXT;
      ALTER TABLE boxel_log_files ADD COLUMN IF NOT EXISTS last_line_length INTEGER;
      ALTER TABLE boxel_log_files ADD COLUMN IF NOT EXISTS last_line_hash TEXT;
      CREATE INDEX IF NOT EXISTS boxel_log_files_realm_url_idx
        ON boxel_log_files (realm_url);
    END
    $$;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS boxel_log_lines;
    DROP TABLE IF EXISTS boxel_log_files;
    DROP TABLE IF EXISTS boxel_log_realms;
  `);
};

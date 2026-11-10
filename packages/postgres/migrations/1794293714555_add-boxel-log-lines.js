// The lines of a realm's append-only logs (`.jsonl` and `.log` files), one
// row each, so a query can filter, sort and count a subset of a log without
// reading the file.
//
// A log is written one line at a time (the `appendLine` operation), and its
// file meta keeps only a tail of recent lines (`contentTailBytes`). These
// rows are the queryable form: the index writer keeps them in step with the
// file when the file is indexed, inserting only the lines a pass added while
// the file has only grown, and rebuilding the file's rows otherwise
// (`log-line-index.ts` in runtime-common).
//
// - `entry` is the line parsed as JSON. A JSON string under `what` (the form
//   JSONLFile's `record` writes) is decoded to its value, so a query reaches
//   `what.action` rather than matching inside a string. A `.log` line, or a
//   line that isn't JSON, is `{ "text": <line> }`, with `at` and `actor` read
//   from the line where LogFile's `record` wrote them.
// - `at` is the entry's time, for range filters and the default order.
// - `boxel_log_files` records, per file, how many lines were indexed and the
//   hash of the last one, which is how a pass tells an append from an edit.
//
// Additive: nothing reads these tables but the log query.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS boxel_log_lines (
      realm_url TEXT NOT NULL,
      url TEXT NOT NULL,
      line_no INTEGER NOT NULL,
      at TIMESTAMPTZ,
      actor TEXT,
      entry JSONB NOT NULL,
      CONSTRAINT boxel_log_lines_pkey PRIMARY KEY (url, line_no)
    );
    -- A log query names its file, so time ranges and order read this.
    CREATE INDEX IF NOT EXISTS boxel_log_lines_at_idx
      ON boxel_log_lines (url, at);
    CREATE INDEX IF NOT EXISTS boxel_log_lines_entry_idx
      ON boxel_log_lines USING gin (entry jsonb_path_ops);

    CREATE TABLE IF NOT EXISTS boxel_log_files (
      url TEXT NOT NULL PRIMARY KEY,
      realm_url TEXT NOT NULL,
      line_count INTEGER NOT NULL,
      last_line_hash TEXT
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS boxel_log_lines;
    DROP TABLE IF EXISTS boxel_log_files;
  `);
};

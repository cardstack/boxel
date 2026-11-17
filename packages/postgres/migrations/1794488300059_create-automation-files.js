// One `automation_files` row per file an automation's run created: the files
// the automation's storage charge prices, and the console's storage view
// lists. A row is written in the same transaction as the file's
// `realm_file_meta` row, when the run's batch commits, and deleted in the
// same transaction as that row when anyone deletes the file. A file the run
// only changed was created by someone else, and has no row.
//
// `realm_url` and `file_path` are the file, spelled as `realm_file_meta`
// spells it, so the charge reads each file's size from there by primary key.
// `automation_id` is the automation card's canonical identifier (RRI), the
// spelling `automations` and `automation_runs` use, and `run_id` the
// `automation_runs` id of the run that created the file. A row outlives its
// automation's `automations` row: removing the automation stops its charge,
// and switching it on again charges for its files again.
//
// One `automation_storage_days` row per switched-on automation and UTC day:
// the bytes its files took on disk and in the index that day, measured by the
// daily storage charge just after the day ends. A storage charge prices the
// days it covers from their own rows, so a file is never billed for a day
// before it existed. The first measurement of a day stands, so a duplicate or
// retried job measures nothing twice. `realm` is the automation's realm's canonical
// identifier, so a deleted realm's rows are deleted with it.
//
// Both tables are server-only, and excluded from the SQLite schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS automation_files (
      realm_url text NOT NULL,
      file_path text NOT NULL,
      automation_id text NOT NULL,
      run_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (realm_url, file_path)
    )
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS automation_files_automation_idx
      ON automation_files (automation_id)
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS automation_storage_days (
      automation_id text NOT NULL,
      day date NOT NULL,
      realm text NOT NULL,
      file_bytes bigint NOT NULL,
      index_bytes bigint NOT NULL,
      measured_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (automation_id, day)
    )
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS automation_storage_days_realm_idx
      ON automation_storage_days (realm)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS automation_storage_days`);
  pgm.sql(`DROP TABLE IF EXISTS automation_files`);
};

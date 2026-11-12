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
// The table is server-only, and excluded from the SQLite schema dump.

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
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS automation_files`);
};

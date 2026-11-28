 

// A Preview's staged files are temporary. `automation_runs` records when
// Boxel dropped a complete Preview's files from `automation_preview_files`,
// and why:
//
// - `preview_files_dropped_at` is when the files were dropped.
// - `preview_files_dropped_reason` is `expired` (the files outlived the days
//   Boxel keeps a Preview's files) or `turned-off` (the automation was turned
//   off).
//
// A Preview whose files a later Preview replaced keeps recording that in
// `preview_replaced_by` instead.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE automation_runs
      ADD COLUMN IF NOT EXISTS preview_files_dropped_at timestamptz,
      ADD COLUMN IF NOT EXISTS preview_files_dropped_reason text
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE automation_runs
      DROP COLUMN IF EXISTS preview_files_dropped_reason,
      DROP COLUMN IF EXISTS preview_files_dropped_at
  `);
};

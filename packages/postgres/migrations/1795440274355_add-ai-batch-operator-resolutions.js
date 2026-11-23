// What an operator decides about a batch the settle job reports and can't
// finish on its own (the `pricing` skill's runbook):
//
// - On `ai_batches`, `written_off_at` and `write_off_reason` record that an
//   operator chose not to bill a settled batch whose charge drew nothing (its
//   payer's balance held nothing, or it has no payer). A written-off batch
//   leaves the list of batches still to bill, and isn't billed after. A batch
//   whose charge is in the ledger isn't written off.
// - On `unrecorded_ai_batches`, `resolution` says how a batch with no row was
//   resolved, beside `resolved_at`: `recorded` when an `ai_batches` row names
//   it (the settle job then bills it like any batch), or the reason an
//   operator gave for dismissing it, such as its being the other
//   environment's batch. A row resolved by hand before resolutions were
//   recorded has none.
//
// Both tables are server-only, and excluded from the SQLite schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE ai_batches
      ADD COLUMN IF NOT EXISTS written_off_at timestamptz,
      ADD COLUMN IF NOT EXISTS write_off_reason text
  `);
  pgm.sql(`
    ALTER TABLE unrecorded_ai_batches
      ADD COLUMN IF NOT EXISTS resolution text
  `);
  // A resolved row whose batch has an `ai_batches` row was resolved by the
  // settle job finding that row, so it reads `recorded`. One with no such row
  // was resolved by hand, for a reason nothing recorded, so it keeps none.
  pgm.sql(`
    UPDATE unrecorded_ai_batches u SET resolution = 'recorded'
    WHERE u.resolved_at IS NOT NULL AND u.resolution IS NULL
      AND EXISTS (SELECT 1 FROM ai_batches b WHERE b.batch_id = u.batch_id)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE unrecorded_ai_batches
      DROP COLUMN IF EXISTS resolution
  `);
  pgm.sql(`
    ALTER TABLE ai_batches
      DROP COLUMN IF EXISTS written_off_at,
      DROP COLUMN IF EXISTS write_off_reason
  `);
};

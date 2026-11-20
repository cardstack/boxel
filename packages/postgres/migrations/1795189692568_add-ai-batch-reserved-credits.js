// What an unsettled batch holds against its payer's balance and its
// automation's credit caps, and the indexes that read it (ADR 030 §1.4).
//
// `reserved_credits` on `ai_batches` is the credits the batch reserved on its
// submitting run's AI spending cap: twice its requests' worst case at the
// model's listed price, once for the batch and once for the normal-price
// requests it falls back to when it misses its deadline. Once the submitting
// run's own credit hold stops counting, an unsettled batch holds this many
// credits in the spending check until the settle job bills it. A row with
// no value (one written by code that doesn't set the column) is held at the
// reservation its run's row names, or failing that at twice its
// `estimated_usd`.
//
// `ai_batches_payer_unsettled_idx` serves the balance check's search for a
// person's unsettled batches. `ai_batches_automation_settled_idx` serves the
// credit caps' search for an automation's unsettled batches, and for the
// batches settled since a day or month began, whose `batched_ai` charges the
// caps count by when they were billed.
//
// The indexes are built CONCURRENTLY, outside a transaction, so neither
// blocks the settle job's or the batch path's writes. An interrupted build
// leaves an INVALID index under the target name, so each CREATE is preceded
// by an unconditional DROP, and a retry rebuilds it.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `ALTER TABLE ai_batches ADD COLUMN IF NOT EXISTS reserved_credits numeric`,
  );
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS ai_batches_payer_unsettled_idx`);
  pgm.sql(`
    CREATE INDEX CONCURRENTLY ai_batches_payer_unsettled_idx
      ON ai_batches (acts_as)
      WHERE settled_at IS NULL
  `);
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS ai_batches_automation_settled_idx`,
  );
  pgm.sql(`
    CREATE INDEX CONCURRENTLY ai_batches_automation_settled_idx
      ON ai_batches (automation_id, settled_at)
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS ai_batches_automation_settled_idx`,
  );
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS ai_batches_payer_unsettled_idx`);
  pgm.sql(`ALTER TABLE ai_batches DROP COLUMN IF EXISTS reserved_credits`);
};

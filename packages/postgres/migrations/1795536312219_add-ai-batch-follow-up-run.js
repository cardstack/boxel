// Each batch's follow-up run: the run that picks up the batch's results once
// its deadline passes (ADR 030 §1.2).
//
// `follow_up_run_id` on `ai_batches` is the `automation_runs` row of the
// batch's follow-up, set by the minute tick once it has made that row and
// enqueued its job. A batch with none has no follow-up started yet.
//
// `follow_up_dropped_at` is when the tick found that the batch can never get
// a follow-up: its deadline passed after its automation was removed, or after
// the automation was switched on again since the batch was submitted.
//
// `ai_batches_follow_up_due_idx` serves the tick's search for batches whose
// deadline has passed and that have no follow-up yet, by deadline. A batch
// leaves the index once its follow-up starts or it is dropped, so the search
// reads only batches still waiting for one.
//
// The index is built CONCURRENTLY, outside a transaction, so it doesn't block
// the batch path's or the settle job's writes. An interrupted build leaves an
// INVALID index under the target name, so the CREATE is preceded by an
// unconditional DROP, and a retry rebuilds it.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `ALTER TABLE ai_batches ADD COLUMN IF NOT EXISTS follow_up_run_id uuid`,
  );
  pgm.sql(
    `ALTER TABLE ai_batches ADD COLUMN IF NOT EXISTS follow_up_dropped_at timestamptz`,
  );
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS ai_batches_follow_up_due_idx`);
  pgm.sql(`
    CREATE INDEX CONCURRENTLY ai_batches_follow_up_due_idx
      ON ai_batches (deadline, batch_id)
      WHERE follow_up_run_id IS NULL AND follow_up_dropped_at IS NULL
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS ai_batches_follow_up_due_idx`);
  pgm.sql(`ALTER TABLE ai_batches DROP COLUMN IF EXISTS follow_up_dropped_at`);
  pgm.sql(`ALTER TABLE ai_batches DROP COLUMN IF EXISTS follow_up_run_id`);
};

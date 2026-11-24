// `ai_batches_deadline_idx` serves the minute tick's search for batches whose
// deadline has passed, each of which gets a follow-up run that picks up its
// results (ADR 030 §1.2). The search reads batches by deadline, within the
// window a batch's results are kept, and skips those whose follow-up run row
// already exists.
//
// The index is built CONCURRENTLY, outside a transaction, so it doesn't block
// the batch path's or the settle job's writes. An interrupted build leaves an
// INVALID index under the target name, so the CREATE is preceded by an
// unconditional DROP, and a retry rebuilds it.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS ai_batches_deadline_idx`);
  pgm.sql(`
    CREATE INDEX CONCURRENTLY ai_batches_deadline_idx
      ON ai_batches (deadline, batch_id)
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS ai_batches_deadline_idx`);
};

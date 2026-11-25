// What a pause and a resume record about a batch's follow-up run (ADR 030
// §1.5): a pause holds the follow-up, and a resume starts it again, acting as
// the person who resumed.
//
// On `ai_batches`:
// - `follow_up_held_at` is when a pause, or a wait for a key approval, held
//   the batch's follow-up run: the run stays pending with no job, and nothing
//   ends it. It is set on a batch whose `follow_up_run_id` names a run, and
//   cleared once that run's job is enqueued again. The partial index serves
//   the search for held follow-ups whose automation is active again.
// - `follow_up_acts_as` is the Matrix user id the follow-up acts as, and is
//   billed to, once a resume lands after the batch was submitted: the person
//   who resumed. A batch with none has its follow-up act as `acts_as`, the
//   submitting run's identity, which the batch itself stays billed to.
// - `follow_up_resumed_at` is when that resume landed. The follow-up's
//   authority dates from it: its identity's sessions must not have been
//   revoked since.
//
// The table is server-only, and excluded from the SQLite schema dump. The
// index is built CONCURRENTLY, outside a transaction, so it doesn't block the
// batch path's or the settle job's writes. An interrupted build leaves an
// INVALID index under the target name, so the CREATE is preceded by an
// unconditional DROP, and a retry rebuilds it.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`
    ALTER TABLE ai_batches
      ADD COLUMN IF NOT EXISTS follow_up_held_at timestamptz,
      ADD COLUMN IF NOT EXISTS follow_up_acts_as text,
      ADD COLUMN IF NOT EXISTS follow_up_resumed_at timestamptz
  `);
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS ai_batches_follow_up_held_idx`);
  pgm.sql(`
    CREATE INDEX CONCURRENTLY ai_batches_follow_up_held_idx
      ON ai_batches (automation_id)
      WHERE follow_up_held_at IS NOT NULL
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`DROP INDEX CONCURRENTLY IF EXISTS ai_batches_follow_up_held_idx`);
  pgm.sql(`
    ALTER TABLE ai_batches
      DROP COLUMN IF EXISTS follow_up_resumed_at,
      DROP COLUMN IF EXISTS follow_up_acts_as,
      DROP COLUMN IF EXISTS follow_up_held_at
  `);
};

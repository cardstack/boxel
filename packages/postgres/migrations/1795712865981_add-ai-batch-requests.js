// What a batch's follow-up run needs from the submit that OpenRouter doesn't
// keep for it (ADR 030 §1.3, §1.5).
//
// - `ai_batches.milestone` is the run milestone the batch started. The
//   follow-up enters it again before its script runs, so the run milestones
//   carry on across the two runs. Null on a batch recorded without one.
// - `ai_batch_requests` holds each batch's requests, as the chat completion
//   bodies the batch path sent, in the order the script listed them. A batch
//   that has no results to give its follow-up (it missed its deadline,
//   failed, expired, or OpenRouter has deleted it) has its follow-up send the
//   same requests at the normal price, and OpenRouter answers a batch with
//   its results only, never its requests. The row goes once the batch's
//   follow-up has ended for good, or the batch can get none.
//
// - `ai_batches.follow_up_unreadable_count` counts the times the batch's
//   follow-up was held because the batch completed and its results couldn't
//   be read from OpenRouter, and `follow_up_retry_at` is when the tick may
//   start that held follow-up again: each hold waits longer than the last,
//   so a batch that stays unreadable costs a tab now and then, not every
//   minute.
//
// The table is server-only, and excluded from the SQLite schema dump, as
// `ai_batches` is.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE ai_batches
      ADD COLUMN IF NOT EXISTS milestone text,
      ADD COLUMN IF NOT EXISTS follow_up_unreadable_count integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS follow_up_retry_at timestamptz
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS ai_batch_requests (
      batch_id text PRIMARY KEY REFERENCES ai_batches (batch_id) ON DELETE CASCADE,
      requests jsonb NOT NULL
    )
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS ai_batch_requests`);
  pgm.sql(`
    ALTER TABLE ai_batches
      DROP COLUMN IF EXISTS follow_up_retry_at,
      DROP COLUMN IF EXISTS follow_up_unreadable_count,
      DROP COLUMN IF EXISTS milestone
  `);
};

// An automation pauses itself after a set number of its own runs fail in a
// row, with `pause_reason` `repeated-failures`. The streak is read from
// `automation_runs`, counting only runs created at or after
// `failures_since`: switch-on and resume set it, so resuming clears the
// streak. Rows already switched on start counting from the migration.
//
// Widening the check and adding a column with a default are additive: code
// that never writes either runs against them unchanged.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE automations
      ADD COLUMN IF NOT EXISTS failures_since timestamptz NOT NULL DEFAULT now()
  `);
  pgm.sql(`
    ALTER TABLE automations
      DROP CONSTRAINT IF EXISTS automations_pause_reason_value_check,
      ADD CONSTRAINT automations_pause_reason_value_check
        CHECK (pause_reason IS NULL OR pause_reason IN
          ('requested', 'payer-lost-access', 'caps-raised', 'batched-ai-enabled',
           'realm-archived', 'repeated-failures'))
  `);
};

exports.down = (pgm) => {
  // The narrower check refuses a row paused for repeated failures, so those
  // rows read as paused at a person's request, which a resume ends the same
  // way.
  pgm.sql(`
    UPDATE automations SET pause_reason = 'requested'
     WHERE pause_reason = 'repeated-failures'
  `);
  pgm.sql(`
    ALTER TABLE automations
      DROP CONSTRAINT IF EXISTS automations_pause_reason_value_check,
      ADD CONSTRAINT automations_pause_reason_value_check
        CHECK (pause_reason IS NULL OR pause_reason IN
          ('requested', 'payer-lost-access', 'caps-raised', 'batched-ai-enabled',
           'realm-archived'))
  `);
  pgm.sql(`ALTER TABLE automations DROP COLUMN IF EXISTS failures_since`);
};

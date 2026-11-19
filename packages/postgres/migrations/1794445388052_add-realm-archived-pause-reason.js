// A paused automation's `pause_reason` may also be `realm-archived`: archiving
// a realm pauses every automation in it that isn't paused already.
//
// Widening the check is additive: code that never writes the new value runs
// against it unchanged.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE automations
      DROP CONSTRAINT IF EXISTS automations_pause_reason_value_check,
      ADD CONSTRAINT automations_pause_reason_value_check
        CHECK (pause_reason IS NULL OR pause_reason IN
          ('requested', 'payer-lost-access', 'caps-raised', 'batched-ai-enabled',
           'realm-archived'))
  `);
};

exports.down = (pgm) => {
  // The narrower check refuses a row paused for the archive, so those rows
  // read as paused at a person's request, which a resume ends the same way.
  pgm.sql(`
    UPDATE automations SET pause_reason = 'requested'
     WHERE pause_reason = 'realm-archived'
  `);
  pgm.sql(`
    ALTER TABLE automations
      DROP CONSTRAINT IF EXISTS automations_pause_reason_value_check,
      ADD CONSTRAINT automations_pause_reason_value_check
        CHECK (pause_reason IS NULL OR pause_reason IN
          ('requested', 'payer-lost-access', 'caps-raised', 'batched-ai-enabled'))
  `);
};

// A switched-on automation whose card stops reading as a declaration (an
// invalid cron expression, a missing cap) pauses with `pause_reason`
// `invalid-declaration`, and `pause_problems` holds what the declaration
// reader found: a JSON array of `{ code, path, message }`. Every pause writes
// the column, and resume clears it, so only a row paused for that reason
// carries problems. No check ties the column to the reason, since code that
// doesn't know the column resumes a row without clearing it; readers read the
// problems only when the reason is `invalid-declaration`.
//
// Widening the check and adding a nullable column are additive: code that
// never writes either runs against them unchanged.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE automations
      ADD COLUMN IF NOT EXISTS pause_problems jsonb
  `);
  pgm.sql(`
    ALTER TABLE automations
      DROP CONSTRAINT IF EXISTS automations_pause_reason_value_check,
      ADD CONSTRAINT automations_pause_reason_value_check
        CHECK (pause_reason IS NULL OR pause_reason IN
          ('requested', 'payer-lost-access', 'caps-raised', 'batched-ai-enabled',
           'realm-archived', 'repeated-failures', 'invalid-declaration'))
  `);
};

exports.down = (pgm) => {
  // The narrower check refuses a row paused for an invalid declaration, so
  // those rows read as paused at a person's request, which a resume ends the
  // same way.
  pgm.sql(`
    UPDATE automations SET pause_reason = 'requested'
     WHERE pause_reason = 'invalid-declaration'
  `);
  pgm.sql(`
    ALTER TABLE automations
      DROP CONSTRAINT IF EXISTS automations_pause_reason_value_check,
      ADD CONSTRAINT automations_pause_reason_value_check
        CHECK (pause_reason IS NULL OR pause_reason IN
          ('requested', 'payer-lost-access', 'caps-raised', 'batched-ai-enabled',
           'realm-archived', 'repeated-failures'))
  `);
  pgm.sql(`ALTER TABLE automations DROP COLUMN IF EXISTS pause_problems`);
};

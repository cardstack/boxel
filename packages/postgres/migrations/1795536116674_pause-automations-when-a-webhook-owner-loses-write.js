// A delivery to an incoming webhook whose owner is no longer a direct writer
// of the automation's realm starts no run and pauses the automation with
// `pause_reason` `webhook-owner-lost-access`, until a direct writer resumes
// it with a trigger naming a webhook the realm can use.
//
// Widening the check is additive: code that never writes the new reason runs
// against it unchanged.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE automations
      DROP CONSTRAINT IF EXISTS automations_pause_reason_value_check,
      ADD CONSTRAINT automations_pause_reason_value_check
        CHECK (pause_reason IS NULL OR pause_reason IN
          ('requested', 'payer-lost-access', 'caps-raised', 'batched-ai-enabled',
           'webhook-changed', 'webhook-owner-lost-access', 'realm-archived',
           'repeated-failures', 'invalid-declaration'))
  `);
};

exports.down = (pgm) => {
  // The narrower check refuses a row paused for a webhook owner who lost
  // write, so those rows read as paused for a changed webhook, which a resume
  // ends the same way: it checks the webhooks again and the payer confirms.
  pgm.sql(`
    UPDATE automations SET pause_reason = 'webhook-changed'
     WHERE pause_reason = 'webhook-owner-lost-access'
  `);
  pgm.sql(`
    ALTER TABLE automations
      DROP CONSTRAINT IF EXISTS automations_pause_reason_value_check,
      ADD CONSTRAINT automations_pause_reason_value_check
        CHECK (pause_reason IS NULL OR pause_reason IN
          ('requested', 'payer-lost-access', 'caps-raised', 'batched-ai-enabled',
           'webhook-changed', 'realm-archived', 'repeated-failures',
           'invalid-declaration'))
  `);
};

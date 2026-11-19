// A switched-on automation whose card names an incoming webhook the payer
// didn't agree to (a trigger pointed at another webhook, or a new webhook
// trigger) pauses with `pause_reason` `webhook-changed` until a direct writer
// resumes it and becomes its payer. The webhooks the payer agreed to are kept
// in `caps_snapshot` under `webhookPaths`, which needs no schema change.
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
           'webhook-changed', 'realm-archived', 'repeated-failures',
           'invalid-declaration'))
  `);
};

exports.down = (pgm) => {
  // The narrower check refuses a row paused for a changed webhook, so those
  // rows read as paused for raised caps, which a resume ends the same way:
  // the payer confirms and a new snapshot is taken.
  pgm.sql(`
    UPDATE automations SET pause_reason = 'caps-raised'
     WHERE pause_reason = 'webhook-changed'
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

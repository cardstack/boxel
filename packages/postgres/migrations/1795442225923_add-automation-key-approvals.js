// An automation waits for its key approvals before it runs (ADR 039).
//
// `automations.state` gains `waiting-for-key-approval`: the automation is
// switched on, but an approval one of its declared operations needs is
// missing or no longer matches the automation. It has no next run, so the
// tick's partial index on `next_run` never holds it.
//
// `automation_key_approvals` holds a key owner's approval for one automation
// to use one binding: one row per binding the automation uses. `version` is
// the automation as the owner approved it: its payer, declared operations,
// script hash, triggers, params and `callApiCalls` cap. `version_key` is the
// SHA-256 of that version without the cap, which a later version matches on;
// `call_api_calls` is the approved cap, which a lower cap still matches.
// A row goes with its automation (removing it, or deleting its card, removes
// the row) and with its binding (revoking or removing the binding removes
// it). The table is server-only, and excluded from the SQLite schema dump.
//
// Both changes are additive: code that never writes the new state runs
// against the wider check unchanged.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE automations
      DROP CONSTRAINT IF EXISTS automations_state_check,
      ADD CONSTRAINT automations_state_check
        CHECK (state IN ('active', 'paused', 'waiting-for-credits', 'done',
                         'waiting-for-key-approval'))
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS automation_key_approvals (
      automation_id text NOT NULL
        REFERENCES automations (automation_id) ON DELETE CASCADE,
      binding_id uuid NOT NULL
        REFERENCES key_bindings (id) ON DELETE CASCADE,
      approved_by text NOT NULL,
      version jsonb NOT NULL,
      version_key text NOT NULL,
      call_api_calls integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (automation_id, binding_id)
    )
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS automation_key_approvals_binding_idx
      ON automation_key_approvals (binding_id)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS automation_key_approvals`);
  // The narrower check refuses a waiting automation, so those rows read as
  // paused, which a resume ends: the payer switches it on again and its
  // approvals are checked by whatever runs then.
  pgm.sql(`
    UPDATE automations SET state = 'paused', pause_reason = 'requested'
     WHERE state = 'waiting-for-key-approval'
  `);
  pgm.sql(`
    ALTER TABLE automations
      DROP CONSTRAINT IF EXISTS automations_state_check,
      ADD CONSTRAINT automations_state_check
        CHECK (state IN ('active', 'paused', 'waiting-for-credits', 'done'))
  `);
};

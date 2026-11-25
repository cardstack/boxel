// `automation_state_changes` is the history of each switched-on automation's
// state: one row each time the automation is switched on, and one each time
// its `state` or `pause_reason` takes a different value. `changed_at` is when
// the change was written. The daily storage charge reads the history to tell
// the days an automation was active from the days it was paused, waiting or
// done, and the storage route reads it to say since when, and why, a stopped
// automation's storage isn't charged.
//
// A trigger on `automations` writes the rows, so every path that switches an
// automation on or moves its state is recorded, whichever code or migration
// writes it. Removing an automation removes its history with it.
//
// Every automation already switched on gets an `active` row at its switch-on,
// and a row for its current state when that is not `active`, so the days
// before this migration charge as they always have.
//
// The table is server-only, and excluded from the SQLite schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS automation_state_changes (
      id bigserial PRIMARY KEY,
      automation_id text NOT NULL
        REFERENCES automations (automation_id) ON DELETE CASCADE,
      state text NOT NULL,
      pause_reason text,
      changed_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS automation_state_changes_automation_idx
      ON automation_state_changes (automation_id, changed_at)
  `);
  pgm.sql(`
    CREATE OR REPLACE FUNCTION automation_state_changes_record()
    RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'INSERT'
         OR NEW.state IS DISTINCT FROM OLD.state
         OR NEW.pause_reason IS DISTINCT FROM OLD.pause_reason THEN
        INSERT INTO automation_state_changes (automation_id, state, pause_reason)
          VALUES (NEW.automation_id, NEW.state, NEW.pause_reason);
      END IF;
      RETURN NULL;
    END
    $$ LANGUAGE plpgsql
  `);
  pgm.sql(`
    DROP TRIGGER IF EXISTS automation_state_changes_record ON automations
  `);
  pgm.sql(`
    CREATE TRIGGER automation_state_changes_record
      AFTER INSERT OR UPDATE OF state, pause_reason ON automations
      FOR EACH ROW EXECUTE FUNCTION automation_state_changes_record()
  `);
  pgm.sql(`
    INSERT INTO automation_state_changes (automation_id, state, changed_at)
    SELECT a.automation_id, 'active', a.switched_on_at FROM automations a
     WHERE NOT EXISTS (SELECT 1 FROM automation_state_changes c
                        WHERE c.automation_id = a.automation_id)
  `);
  pgm.sql(`
    INSERT INTO automation_state_changes (automation_id, state, pause_reason)
    SELECT a.automation_id, a.state, a.pause_reason FROM automations a
     WHERE a.state <> 'active'
       AND (SELECT c.state FROM automation_state_changes c
             WHERE c.automation_id = a.automation_id
             ORDER BY c.changed_at DESC, c.id DESC LIMIT 1) = 'active'
  `);
};

exports.down = (pgm) => {
  pgm.sql(
    `DROP TRIGGER IF EXISTS automation_state_changes_record ON automations`,
  );
  pgm.sql(`DROP FUNCTION IF EXISTS automation_state_changes_record()`);
  pgm.sql(`DROP TABLE IF EXISTS automation_state_changes`);
};

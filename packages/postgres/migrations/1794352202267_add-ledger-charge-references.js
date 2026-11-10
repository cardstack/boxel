// What a `credits_ledger` entry paid for (ADR 029 §1.6).
//
// - `charge_kind`: run, run_indexing, storage, ai, batched_ai, grant,
//   purchase or expiry. An entry without one reads the kind its credit type
//   implies (`chargeKindForCreditType` in runtime-common).
// - `realm`: the realm's canonical identifier, on consumption entries.
// - The reference: `run_id` (an `automation_runs` id) for run, run indexing
//   and AI made by a run; `run_id` and `batch_id` for batched AI;
//   `automation_id` (the automation card's identifier) and `charge_day` for
//   storage.
// - `pricing_version`: the hash of the prices a metered charge was priced at.
//
// The columns are nullable, so an entry written without them, including one
// written during a rolling deploy by a process that doesn't set them, reads
// correctly. The CHECK holds each kind to the reference it needs. It is added
// NOT VALID, so this migration takes the table's lock only briefly; the next
// migration validates it without blocking writes.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE credits_ledger
      ADD COLUMN IF NOT EXISTS charge_kind text,
      ADD COLUMN IF NOT EXISTS realm text,
      ADD COLUMN IF NOT EXISTS run_id uuid,
      ADD COLUMN IF NOT EXISTS batch_id text,
      ADD COLUMN IF NOT EXISTS automation_id text,
      ADD COLUMN IF NOT EXISTS charge_day date,
      ADD COLUMN IF NOT EXISTS pricing_version text
  `);
  pgm.sql(`
    ALTER TABLE credits_ledger
      DROP CONSTRAINT IF EXISTS credits_ledger_charge_reference_check
  `);
  pgm.sql(`
    ALTER TABLE credits_ledger
      ADD CONSTRAINT credits_ledger_charge_reference_check CHECK (
        charge_kind IS NULL OR CASE charge_kind
          WHEN 'run' THEN
            realm IS NOT NULL AND run_id IS NOT NULL
            AND batch_id IS NULL AND automation_id IS NULL
            AND charge_day IS NULL AND pricing_version IS NOT NULL
          WHEN 'run_indexing' THEN
            realm IS NOT NULL AND run_id IS NOT NULL
            AND batch_id IS NULL AND automation_id IS NULL
            AND charge_day IS NULL AND pricing_version IS NOT NULL
          WHEN 'storage' THEN
            realm IS NOT NULL AND automation_id IS NOT NULL
            AND charge_day IS NOT NULL AND pricing_version IS NOT NULL
            AND run_id IS NULL AND batch_id IS NULL
          WHEN 'batched_ai' THEN
            realm IS NOT NULL AND run_id IS NOT NULL AND batch_id IS NOT NULL
            AND automation_id IS NULL AND charge_day IS NULL
          WHEN 'ai' THEN
            batch_id IS NULL AND automation_id IS NULL AND charge_day IS NULL
          WHEN 'grant' THEN
            realm IS NULL AND run_id IS NULL AND batch_id IS NULL
            AND automation_id IS NULL AND charge_day IS NULL
          WHEN 'purchase' THEN
            realm IS NULL AND run_id IS NULL AND batch_id IS NULL
            AND automation_id IS NULL AND charge_day IS NULL
          WHEN 'expiry' THEN
            realm IS NULL AND run_id IS NULL AND batch_id IS NULL
            AND automation_id IS NULL AND charge_day IS NULL
          ELSE false
        END
      ) NOT VALID
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE credits_ledger
      DROP CONSTRAINT IF EXISTS credits_ledger_charge_reference_check
  `);
  pgm.sql(`
    ALTER TABLE credits_ledger
      DROP COLUMN IF EXISTS pricing_version,
      DROP COLUMN IF EXISTS charge_day,
      DROP COLUMN IF EXISTS automation_id,
      DROP COLUMN IF EXISTS batch_id,
      DROP COLUMN IF EXISTS run_id,
      DROP COLUMN IF EXISTS realm,
      DROP COLUMN IF EXISTS charge_kind
  `);
};

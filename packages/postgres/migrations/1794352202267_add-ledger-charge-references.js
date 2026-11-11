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
// - `charge_id`: one id shared by every row a single spend writes (one per
//   credit bucket it draws on), naming the charge its usage belongs to.
//
// `credit_charge_usage` records how much of each unit a charge priced, one
// row per unit: tab-seconds, worker-process-seconds, GB downloaded,
// GB-months stored, or the AI provider's reported USD cost. With the charge's
// pricing version, a charge's credits can be recomputed from its usage, and a
// user's or realm's usage can be audited apart from what it cost. It is keyed
// by `charge_id`, not by ledger row, because one charge spans several rows
// and some charges price two units (indexing: worker and tab time; storage:
// files and index rows). `user_id` is repeated on it so a user's usage reads
// without a join.
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
      ADD COLUMN IF NOT EXISTS pricing_version text,
      ADD COLUMN IF NOT EXISTS charge_id uuid
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS credit_charge_usage (
      charge_id uuid NOT NULL,
      unit text NOT NULL,
      quantity numeric NOT NULL,
      user_id uuid NOT NULL REFERENCES users(id),
      created_at integer NOT NULL
        DEFAULT EXTRACT(epoch FROM CURRENT_TIMESTAMP)::integer,
      PRIMARY KEY (charge_id, unit),
      CONSTRAINT credit_charge_usage_unit_check CHECK (unit IN (
        'prerender_tab_seconds',
        'worker_process_seconds',
        'downloaded_gb',
        'file_storage_gb_months',
        'database_storage_gb_months',
        'ai_provider_usd',
        'ai_input_tokens',
        'ai_output_tokens'
      )),
      CONSTRAINT credit_charge_usage_quantity_check CHECK (quantity >= 0)
    )
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS credit_charge_usage_user_id_idx
      ON credit_charge_usage (user_id, created_at)
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
  pgm.sql(`DROP TABLE IF EXISTS credit_charge_usage`);
  pgm.sql(`
    ALTER TABLE credits_ledger
      DROP CONSTRAINT IF EXISTS credits_ledger_charge_reference_check
  `);
  pgm.sql(`
    ALTER TABLE credits_ledger
      DROP COLUMN IF EXISTS charge_id,
      DROP COLUMN IF EXISTS pricing_version,
      DROP COLUMN IF EXISTS charge_day,
      DROP COLUMN IF EXISTS automation_id,
      DROP COLUMN IF EXISTS batch_id,
      DROP COLUMN IF EXISTS run_id,
      DROP COLUMN IF EXISTS realm,
      DROP COLUMN IF EXISTS charge_kind
  `);
};

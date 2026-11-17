// What the batch settle job records when it bills a batch (ADR 030 §1.4),
// and how the cost coverage report tells a batch billed at its estimate from
// one billed at the cost OpenRouter reported.
//
// On `ai_batches`:
// - `finalized_at` is when the batch reached a final status: OpenRouter's
//   `finalized_at` when it reports one, otherwise when the platform first
//   read a final status.
// - `deadline_missed_at` is when a run first read the batch, at or after its
//   `deadline`, and found it still open. That run sends the same requests at
//   the normal price (ADR 030 §1.3), so the batch is late from then on, and
//   its results are withheld from the runs that read it.
// - `settle_read_at` is when the settle job last tried to read the batch. The
//   job reads the least recently tried batches first, so batches OpenRouter
//   can't answer for don't hold back the rest.
// - `settled_at` is when the settle job billed the batch, and `billed_usd`
//   what it billed: OpenRouter's reported cost, or `estimated_usd` when
//   OpenRouter reported none, in which case `billed_at_estimate` is true. A
//   batch with no `settled_at` is unsettled, and its cost reads as pending.
//   The partial index serves the settle job's search for them.
//
// `unrecorded_ai_batches` holds each batch OpenRouter lists that has no
// `ai_batches` row: a batch the platform may be paying for with nothing to
// bill it from. The settle job adds one row per such batch, the first time it
// finds it, so each is reported once. An operator bills it by hand and
// records that in `resolved_at`.
//
// `credit_charge_usage` gains the unit `ai_estimated_usd`: the estimate a
// batched AI charge was billed at when its provider reported no cost. The
// `credit_charge_costs` view prices such a charge at its estimate and marks it
// `cost_estimated`, so the cost coverage report can say how much of a batched
// AI line rests on an estimate rather than on what the provider charged.
//
// Every table here is server-only, and excluded from the SQLite schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE ai_batches
      ADD COLUMN IF NOT EXISTS finalized_at timestamptz,
      ADD COLUMN IF NOT EXISTS deadline_missed_at timestamptz,
      ADD COLUMN IF NOT EXISTS settle_read_at timestamptz,
      ADD COLUMN IF NOT EXISTS settled_at timestamptz,
      ADD COLUMN IF NOT EXISTS billed_usd numeric,
      ADD COLUMN IF NOT EXISTS billed_at_estimate boolean
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS ai_batches_unsettled_idx
      ON ai_batches (settle_read_at NULLS FIRST, submitted_at)
      WHERE settled_at IS NULL
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS unrecorded_ai_batches (
      batch_id text PRIMARY KEY,
      model text,
      status text,
      request_count integer,
      cost_usd numeric,
      created_at timestamptz,
      found_at timestamptz NOT NULL DEFAULT now(),
      resolved_at timestamptz
    )
  `);
  // Added NOT VALID, so this migration holds the table's lock only briefly
  // instead of scanning every usage row under it; the next migration
  // validates the check under a lock that lets charges keep writing.
  pgm.sql(`
    ALTER TABLE credit_charge_usage
      DROP CONSTRAINT IF EXISTS credit_charge_usage_unit_check
  `);
  pgm.sql(`
    ALTER TABLE credit_charge_usage
      ADD CONSTRAINT credit_charge_usage_unit_check CHECK (unit IN (
        'prerender_tab_seconds',
        'worker_process_seconds',
        'downloaded_gb',
        'file_storage_gb_months',
        'database_storage_gb_months',
        'ai_provider_usd',
        'ai_estimated_usd',
        'ai_input_tokens',
        'ai_output_tokens'
      )) NOT VALID
  `);
  pgm.sql(creditChargeCostsView({ withEstimates: true }));
};

exports.down = (pgm) => {
  pgm.sql(`DROP VIEW IF EXISTS credit_charge_costs`);
  pgm.sql(creditChargeCostsView({ withEstimates: false }));
  pgm.sql(`DELETE FROM credit_charge_usage WHERE unit = 'ai_estimated_usd'`);
  pgm.sql(`
    ALTER TABLE credit_charge_usage
      DROP CONSTRAINT IF EXISTS credit_charge_usage_unit_check
  `);
  pgm.sql(`
    ALTER TABLE credit_charge_usage
      ADD CONSTRAINT credit_charge_usage_unit_check CHECK (unit IN (
        'prerender_tab_seconds',
        'worker_process_seconds',
        'downloaded_gb',
        'file_storage_gb_months',
        'database_storage_gb_months',
        'ai_provider_usd',
        'ai_input_tokens',
        'ai_output_tokens'
      ))
  `);
  pgm.sql(`DROP TABLE IF EXISTS unrecorded_ai_batches`);
  pgm.sql(`DROP INDEX IF EXISTS ai_batches_unsettled_idx`);
  pgm.sql(`
    ALTER TABLE ai_batches
      DROP COLUMN IF EXISTS finalized_at,
      DROP COLUMN IF EXISTS deadline_missed_at,
      DROP COLUMN IF EXISTS settle_read_at,
      DROP COLUMN IF EXISTS settled_at,
      DROP COLUMN IF EXISTS billed_usd,
      DROP COLUMN IF EXISTS billed_at_estimate
  `);
};

// The `credit_charge_costs` view. With estimates, an AI charge with no
// provider cost is priced at the estimate it was billed at, and the trailing
// `cost_estimated` column says so.
function creditChargeCostsView({ withEstimates }) {
  let aiCost = withEstimates ? 'COALESCE(ai.usd, estimate.usd)' : 'ai.usd';
  let estimateJoin = withEstimates
    ? `
      LEFT JOIN LATERAL (
        SELECT u.quantity AS usd
        FROM credit_charge_usage u
        WHERE u.charge_id = c.charge_id AND u.unit = 'ai_estimated_usd'
      ) estimate ON true`
    : '';
  let estimatedColumn = withEstimates
    ? `,
        c.charge_kind IN ('ai', 'batched_ai')
          AND ai.usd IS NULL AND estimate.usd IS NOT NULL AS cost_estimated`
    : '';
  let estimatedOutput = withEstimates
    ? `,
      cost_estimated`
    : '';
  return `
    CREATE OR REPLACE VIEW credit_charge_costs AS
    WITH kinded AS (
      SELECT
        l.*,
        COALESCE(l.charge_kind, CASE l.credit_type
          WHEN 'plan_allowance_used' THEN 'ai'
          WHEN 'extra_credit_used' THEN 'ai'
          WHEN 'daily_credit_used' THEN 'ai'
        END) AS read_charge_kind
      FROM credits_ledger l
    ),
    charges AS (
      SELECT
        COALESCE(charge_id, id) AS charge_id,
        read_charge_kind AS charge_kind,
        pricing_version,
        user_id,
        realm,
        created_at,
        -SUM(credit_amount) AS credits
      FROM kinded
      WHERE read_charge_kind IN ('run', 'run_indexing', 'storage', 'ai', 'batched_ai')
      GROUP BY 1, 2, 3, 4, 5, 6
    ),
    costed AS (
      SELECT
        c.*,
        CASE
          WHEN c.charge_kind IN ('ai', 'batched_ai') THEN ${aiCost}
          WHEN v.version IS NULL OR metered.unpriced_units > 0 THEN NULL
          ELSE metered.usd
        END AS cost_usd,
        CASE
          WHEN c.charge_kind IN ('ai', 'batched_ai') THEN 1
          ELSE v.margin
        END AS margin${estimatedColumn}
      FROM charges c
      LEFT JOIN pricing_versions v ON v.version = c.pricing_version
      LEFT JOIN LATERAL (
        SELECT
          SUM(u.quantity * r.usd_per_unit) AS usd,
          COUNT(*) FILTER (WHERE r.unit IS NULL) AS unpriced_units
        FROM credit_charge_usage u
        LEFT JOIN pricing_version_rates r
          ON r.pricing_version = c.pricing_version AND r.unit = u.unit
        WHERE u.charge_id = c.charge_id
          AND u.unit NOT IN (${withEstimates ? "'ai_provider_usd', 'ai_estimated_usd'" : "'ai_provider_usd'"}, 'ai_input_tokens', 'ai_output_tokens')
      ) metered ON true
      LEFT JOIN LATERAL (
        SELECT u.quantity AS usd
        FROM credit_charge_usage u
        WHERE u.charge_id = c.charge_id AND u.unit = 'ai_provider_usd'
      ) ai ON true${estimateJoin}
    ),
    in_full AS (
      SELECT
        costed.*,
        -- What the charge draws when the balance covers it: a metered
        -- charge rounds its cost at the margin up to a whole credit, an AI
        -- charge rounds its cost to the nearest credit. The small tolerance
        -- keeps a cost the charging process computed as a whole number from
        -- rounding up here.
        CASE
          WHEN cost_usd IS NULL THEN NULL
          WHEN charge_kind IN ('ai', 'batched_ai') THEN ROUND(cost_usd * 1000)
          ELSE CEIL(cost_usd * margin * 1000 - 0.000001)
        END AS full_credits
      FROM costed
    )
    SELECT
      charge_id,
      charge_kind,
      pricing_version,
      user_id,
      realm,
      created_at,
      credits,
      cost_usd,
      margin,
      full_credits,
      GREATEST(full_credits - credits, 0) AS unpaid_credits${estimatedOutput}
    FROM in_full
  `;
}

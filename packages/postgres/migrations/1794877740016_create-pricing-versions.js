// The prices each pricing version stands for, and every consumption charge
// beside the cost of the usage it priced.
//
// `pricing_versions` records, once per version, the values a process checked
// at startup (`pricing_version_values`, by variable name) and the USD each
// metered unit costs at them (`pricing_version_rates`, by
// `credit_charge_usage` unit). A version is a hash of its values, so a version
// recorded twice records the same thing, and a row is never changed. Charges
// are priced from the process's environment, never from these tables
// (ADR 029 §1.2): they are the audit record that lets a charge's usage be
// priced again after the startup log that named the version is gone.
//
// `credit_charge_costs` has one row per consumption charge (run, run
// indexing, storage, AI, batched AI): the credits it drew, and the hosting
// cost of the usage it recorded. A metered charge's cost is each unit's
// quantity at its pricing version's rate, and its margin is that version's.
// An AI charge's cost is the provider's reported cost, with no margin
// (ADR 029 §1.1). The cost is null when it can't be priced: the charge has no
// usage, its pricing version isn't recorded, or a unit it used has no rate at
// that version. A ledger row with no `charge_id` is a charge of its own, and
// one with no `charge_kind` reads the kind its credit type implies.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS pricing_versions (
      version text PRIMARY KEY,
      margin numeric NOT NULL,
      recorded_at integer NOT NULL
        DEFAULT EXTRACT(epoch FROM CURRENT_TIMESTAMP)::integer,
      CONSTRAINT pricing_versions_margin_check CHECK (margin >= 1)
    )
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS pricing_version_values (
      pricing_version text NOT NULL
        REFERENCES pricing_versions(version) ON DELETE CASCADE,
      variable text NOT NULL,
      value numeric NOT NULL,
      PRIMARY KEY (pricing_version, variable)
    )
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS pricing_version_rates (
      pricing_version text NOT NULL
        REFERENCES pricing_versions(version) ON DELETE CASCADE,
      unit text NOT NULL,
      usd_per_unit numeric NOT NULL,
      PRIMARY KEY (pricing_version, unit),
      CONSTRAINT pricing_version_rates_unit_check CHECK (unit IN (
        'prerender_tab_seconds',
        'worker_process_seconds',
        'downloaded_gb',
        'file_storage_gb_months',
        'database_storage_gb_months'
      )),
      CONSTRAINT pricing_version_rates_usd_check CHECK (usd_per_unit > 0)
    )
  `);
  pgm.sql(`
    CREATE OR REPLACE VIEW credit_charge_costs AS
    WITH charges AS (
      SELECT
        COALESCE(l.charge_id, l.id) AS charge_id,
        COALESCE(l.charge_kind, CASE l.credit_type
          WHEN 'plan_allowance_used' THEN 'ai'
          WHEN 'extra_credit_used' THEN 'ai'
          WHEN 'daily_credit_used' THEN 'ai'
        END) AS charge_kind,
        l.pricing_version,
        l.user_id,
        l.realm,
        l.created_at,
        -SUM(l.credit_amount) AS credits
      FROM credits_ledger l
      WHERE COALESCE(l.charge_kind, CASE l.credit_type
          WHEN 'plan_allowance_used' THEN 'ai'
          WHEN 'extra_credit_used' THEN 'ai'
          WHEN 'daily_credit_used' THEN 'ai'
        END) IN ('run', 'run_indexing', 'storage', 'ai', 'batched_ai')
      GROUP BY 1, 2, 3, 4, 5, 6
    )
    SELECT
      c.charge_id,
      c.charge_kind,
      c.pricing_version,
      c.user_id,
      c.realm,
      c.created_at,
      c.credits,
      CASE
        WHEN c.charge_kind IN ('ai', 'batched_ai') THEN ai.usd
        WHEN v.version IS NULL OR metered.unpriced_units > 0 THEN NULL
        ELSE metered.usd
      END AS cost_usd,
      CASE
        WHEN c.charge_kind IN ('ai', 'batched_ai') THEN 1
        ELSE v.margin
      END AS margin
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
        AND u.unit NOT IN ('ai_provider_usd', 'ai_input_tokens', 'ai_output_tokens')
    ) metered ON true
    LEFT JOIN LATERAL (
      SELECT u.quantity AS usd
      FROM credit_charge_usage u
      WHERE u.charge_id = c.charge_id AND u.unit = 'ai_provider_usd'
    ) ai ON true
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP VIEW IF EXISTS credit_charge_costs`);
  pgm.sql(`DROP TABLE IF EXISTS pricing_version_rates`);
  pgm.sql(`DROP TABLE IF EXISTS pricing_version_values`);
  pgm.sql(`DROP TABLE IF EXISTS pricing_versions`);
};

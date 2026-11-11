// One `automations` row per switched-on automation: the server half of an
// automation, whose card holds its definition (ADR 028 §1.3). The row holds
// who pays for the automation and where it is, which writing the card can't
// change.
//
// `automation_id` is the automation card and `realm` its realm, as canonical
// identifiers (RRIs), never served URLs, the same spellings `automation_runs`
// uses, so a run joins its automation on `automation_id`. `payer` is the
// Matrix user id of the direct writer who switched the automation on or last
// resumed it.
//
// `state` is `active`, `paused`, `waiting-for-credits` or `done`. A paused
// automation has a `pause_reason` code (such as `requested` or
// `payer-lost-access`) and no other state has one; `paused_by` names the
// person who paused it, when a person did.
//
// `caps_snapshot` is the card's caps, and whether it turned on `batchedAI`,
// as they were when the payer switched it on or resumed it: a JSON object
// keyed by cap name, so a cap the card gains is snapshotted with it. A later
// card edit that raises a cap above it, or turns on `batchedAI`, pauses the
// automation.
//
// `trigger_runs` is each trigger's run state, keyed by its label: the runs it
// started, the last slot handled for it and when its timing last changed, in
// unix seconds. It is keyed by label so editing the card's other fields keeps
// a trigger's count, and a renamed label starts a new one (ADR 028 §1.4).
//
// `scheduled_since` is when the automation was switched on or last resumed:
// no slot at or before it is due. `next_run` is the earliest next run across
// its unspent cron and one-time triggers, null when none is left. The partial
// index on it serves the tick's search for due automations: an active one, or
// one waiting for credits, which carries on at its next due time once its
// payer's balance recovers.
// The `last_*` columns are the most recent run's enqueue, start, finish and
// result.
//
// The table is server-only, and excluded from the SQLite schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS automations (
      automation_id text PRIMARY KEY,
      realm text NOT NULL,
      payer text NOT NULL,
      state text NOT NULL DEFAULT 'active',
      pause_reason text,
      paused_by text,
      caps_snapshot jsonb NOT NULL,
      trigger_runs jsonb NOT NULL DEFAULT '{}'::jsonb,
      scheduled_since timestamptz NOT NULL,
      next_run timestamptz,
      last_enqueued_at timestamptz,
      last_started_at timestamptz,
      last_finished_at timestamptz,
      last_result text,
      switched_on_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT automations_state_check
        CHECK (state IN ('active', 'paused', 'waiting-for-credits', 'done')),
      CONSTRAINT automations_pause_reason_check
        CHECK ((state = 'paused') = (pause_reason IS NOT NULL)),
      CONSTRAINT automations_last_result_check
        CHECK (last_result IS NULL OR last_result IN ('complete', 'error', 'canceled'))
    )
  `);
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS automations_realm_idx ON automations (realm)`,
  );
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS automations_payer_idx ON automations (payer)`,
  );
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS automations_due_idx
      ON automations (next_run)
      WHERE state IN ('active', 'waiting-for-credits') AND next_run IS NOT NULL
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS automations`);
};

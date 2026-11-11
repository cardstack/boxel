// One `automation_runs` row per run of an automation: the source of truth for
// where the run is, which queue attempt owns it, and whether its writes have
// been committed. The realm server must check each run-token call against this
// row, and a retried job reads it to learn whether the script still has to
// run.
//
// A run is keyed by its automation, trigger and slot (the same three a run's
// `dedupeKey` names), so enqueueing the same run twice finds one row. The
// automation, its realm and the script file are stored as canonical
// identifiers (RRIs), never as served URLs. `acts_as` is the Matrix user id
// of the person the run acts as.
//
// `state` moves pending → running → complete, error or canceled. `attempt`
// is the job reservation id of the queue attempt that owns a running run; a
// retry, whose reservation id is greater, takes the run over by writing its
// own. `commit_started_at` is set once, when the owning attempt
// claims the commit, and `committed_at` when the batch has landed, so a run
// commits at most once however many times its job runs. `error_reason` is a
// code (such as `script-error` or `timed-out`) and `error_message` its
// detail; `canceled_by` names who canceled.
//
// The metered counts are for the realm server to add to where it does the
// work, never taking them from the tab. A deleted realm's runs are deleted
// with it, found by the `realm` index. The partial index on unfinished runs
// serves a sweep for runs left pending or running.
//
// The table is server-only, and excluded from the SQLite schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS automation_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      automation_id text NOT NULL,
      realm text NOT NULL,
      trigger text NOT NULL,
      slot text NOT NULL,
      acts_as text NOT NULL,
      attempt bigint,
      script_id text,
      script_hash text,
      state text NOT NULL DEFAULT 'pending',
      error_reason text,
      error_message text,
      canceled_by text,
      call_api_calls integer NOT NULL DEFAULT 0,
      call_api_response_bytes bigint NOT NULL DEFAULT 0,
      resolve_calls integer NOT NULL DEFAULT 0,
      writes integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      commit_started_at timestamptz,
      committed_at timestamptz,
      finished_at timestamptz,
      CONSTRAINT automation_runs_state_check
        CHECK (state IN ('pending', 'running', 'complete', 'error', 'canceled')),
      CONSTRAINT automation_runs_slot_key UNIQUE (automation_id, trigger, slot)
    )
  `);
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS automation_runs_realm_idx ON automation_runs (realm)`,
  );
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS automation_runs_unfinished_idx
      ON automation_runs (state, created_at)
      WHERE state IN ('pending', 'running')
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS automation_runs`);
};

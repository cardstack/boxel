// Indexes `automation_run_log`'s `trigger` lines by time, so a read of the
// trigger lines in a time range touches only those lines. The Automations
// dashboard's Skipped slots panels count the trigger lines that carry
// `skipped` over the dashboard's time range. Without this index Postgres
// scans every run's log on each refresh, and a run keeps up to
// `RUN_LOG_MAX_LINES` lines.
//
// Trigger lines are a small share of a run's log (one per slot that started
// or joined the run, plus one per reconcile requeue), so the index is partial
// on `kind = 'trigger'`. The predicate stops at `kind` rather than also
// requiring `skipped`: the planner matches a partial index only when a
// query's WHERE clause implies its predicate, and `skipped` lives in `data`,
// so a predicate on it would hold only while every reader spells the filter
// as `(data->>'skipped')::boolean`. Keeping the started lines costs one index
// entry per run, against the up to thousands of lines a run's log holds.
//
// The index is built CONCURRENTLY, outside a transaction, so building it
// doesn't block the run log's writes. node-pg-migrate logs
// `#> WARNING: Need to break single transaction! <` when applying this
// migration; that is expected, not a failure. An interrupted CONCURRENTLY
// build leaves an INVALID index under the target name, so the CREATE is
// preceded by an unconditional DROP, and a retry rebuilds it.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS automation_run_log_trigger_at_idx`,
  );
  pgm.sql(`
    CREATE INDEX CONCURRENTLY automation_run_log_trigger_at_idx
      ON automation_run_log (at) WHERE kind = 'trigger'
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(
    `DROP INDEX CONCURRENTLY IF EXISTS automation_run_log_trigger_at_idx`,
  );
};

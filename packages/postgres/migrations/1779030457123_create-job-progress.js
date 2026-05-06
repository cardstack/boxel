exports.shorthands = undefined;

// Per-job indexing progress tracked alongside `jobs` / `job_reservations`,
// written through from each realm-server's IndexingEventSink so the
// Boxel Jobs Grafana dashboard can render an "Active Indexing" table
// aggregated across every realm-server / worker ECS task. CS-10930.
//
// UNLOGGED:
//   Progress data is ephemeral — if Postgres crashes mid-indexing, the
//   indexing job restarts and the dashboard repopulates from the new
//   IndexingEventSink writes. There is no historical value to losing,
//   and UNLOGGED bypasses WAL + replication for this hot-write table.
//   (node-pg-migrate 6.2.2's createTable doesn't expose UNLOGGED, so
//   the table is built with raw SQL.)
//
// PK on job_id, not reservation_id:
//   The IndexingEventSink wire-format is keyed by jobId (events
//   already carry it; reservation_id would require plumbing a new
//   field through @cardstack/runtime-common's IndexingProgressEvent).
//   On retry, the new attempt UPSERTs over the prior progress; the
//   dashboard always shows current state. Per-attempt history is a
//   follow-up if operators ask for it.
//
// ON DELETE CASCADE from jobs:
//   When a job row is removed (currently rare in production — old
//   jobs accumulate), its progress row goes with it.
exports.up = (pgm) => {
  pgm.sql(`
    CREATE UNLOGGED TABLE job_progress (
      job_id           integer PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
      total_files      integer   NOT NULL DEFAULT 0,
      files_completed  integer   NOT NULL DEFAULT 0,
      last_progress_at timestamp NOT NULL DEFAULT NOW()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS job_progress;`);
};

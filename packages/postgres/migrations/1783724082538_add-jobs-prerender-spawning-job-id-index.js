/* eslint-disable camelcase */

// Partial expression index correlating a prerender_html job back to the
// indexing pass that spawned it (the spawningJobId its args carry). The
// Grafana indexing dashboard resolves a prerender_job_id per displayed
// indexing job through this expression, so each lookup is an index probe
// instead of a scan over all accumulated prerender_html jobs. The second
// key column lets a MAX(id)/ORDER BY id probe resolve newest-wins without
// touching the heap.
//
// The index expression must match the dashboard rawSql exactly —
// ((args->>'spawningJobId')::bigint) — or the planner will not use it.
//
// CONCURRENTLY avoids locking queue writes during the build in
// production; it cannot run inside a transaction, hence noTransaction().

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS jobs_prerender_html_spawning_job_id_idx
      ON jobs (((args->>'spawningJobId')::bigint), id)
      WHERE job_type = 'prerender_html'
        AND args->>'spawningJobId' IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`
    DROP INDEX CONCURRENTLY IF EXISTS jobs_prerender_html_spawning_job_id_idx;
  `);
};

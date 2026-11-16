// The prerender tab time a run's script took, in milliseconds, summed over
// the attempts that ran it. The run's compute charge prices it (ADR 029
// §1.1), together with the bytes its `callApi` calls downloaded
// (`call_api_response_bytes`).

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE automation_runs
      ADD COLUMN IF NOT EXISTS prerender_tab_ms bigint NOT NULL DEFAULT 0
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE automation_runs
      DROP COLUMN IF EXISTS prerender_tab_ms
  `);
};

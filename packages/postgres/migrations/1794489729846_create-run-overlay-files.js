// The run overlay (ADR 027 §1.2): one row per file an automation run's
// attempt has staged, keyed by the run, the attempt and the file's
// realm-local path. The bytes are inline (`content`), text or binary alike,
// and `size` is their length. A run stages at most its `writes` cap of
// files, each within the realm's size limit for its kind, so that bounds a
// run's overlay.
//
// Every realm-server instance reads the same overlay, since a run's calls can
// land on any of them. Deleting the run row deletes its overlay. The table is
// server-only, and excluded from the SQLite schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS run_overlay_files (
      run_id uuid NOT NULL REFERENCES automation_runs (id) ON DELETE CASCADE,
      attempt bigint NOT NULL,
      path text NOT NULL,
      content bytea NOT NULL,
      size integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (run_id, attempt, path)
    )
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS run_overlay_files`);
};

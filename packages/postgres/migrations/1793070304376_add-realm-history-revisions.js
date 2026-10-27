// One row per revision a realm-server recorded in a realm's history, in the
// order the revisions were committed (`seq`). A row is written when its
// revision is recorded and stamped `materialized_at` once the revision's bytes
// are on disk, so a realm whose oldest unstamped row is older than its HEAD has
// a write that died between the two, which recovery completes. `results` is
// what the write answered with, so a retry under the same operation id answers
// the same way without writing again.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS realm_history_revisions (
      seq bigserial PRIMARY KEY,
      realm_url varchar NOT NULL,
      revision varchar NOT NULL,
      parent varchar NOT NULL,
      operation_id varchar NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT now(),
      materialized_at timestamptz,
      results jsonb,
      UNIQUE (realm_url, operation_id),
      UNIQUE (realm_url, revision)
    )
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS realm_history_revisions_unmaterialized
      ON realm_history_revisions (realm_url, seq)
      WHERE materialized_at IS NULL
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS realm_history_revisions`);
};

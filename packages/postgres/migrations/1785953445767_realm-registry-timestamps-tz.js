exports.shorthands = undefined;

// realm_registry.created_at / updated_at were `timestamp` (without time zone),
// defaulted from now(). `pg` parses such a value into a JS Date interpreted in
// the Node process's local time, so serving these to the workspace chooser
// shifted them by the process's UTC offset whenever the realm-server's TZ
// differed from the DB session's (e.g. "Created 8 hrs ago" on a non-UTC box).
// Widen both to `timestamptz` so the stored instant is unambiguous. The existing
// values were written by now() against a UTC DB session, so reinterpret their
// wall-clock as UTC. Backward-compatible: the previously deployed code did not
// read these columns, and now() inserts fine into either type — so this is an
// additive migration.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE realm_registry
      ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
      ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC'
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE realm_registry
      ALTER COLUMN created_at TYPE timestamp USING created_at AT TIME ZONE 'UTC',
      ALTER COLUMN updated_at TYPE timestamp USING updated_at AT TIME ZONE 'UTC'
  `);
};

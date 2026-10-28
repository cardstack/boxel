// What a realm's recovery needs from the history journal, and the realm's own
// recovery state.
//
// `realm_history_revisions` gains:
//   - `state`: a row is inserted `pending`, and committed to the database,
//     before its write asks history to record anything, so a write whose
//     outcome is lost still leaves a trace that recovery resolves. It becomes
//     `committed` beside the revision, or `aborted` once history reports the
//     operation absent (which fences it). `revision` and `parent` are unknown
//     until then.
//   - `paths`: the paths the revision wrote or deleted, so recovery knows what
//     to bring up to HEAD for a revision whose bytes never all reached disk.
//   - `kind`: `write` for a revision a request made, `drift` for changes found
//     on disk that no revision explains, `gap` for changes made while the realm
//     was not recording.
//   - `post_committed_at`: when the revision's index pass was queued, so a
//     revision whose bytes reached disk but whose indexing never started is
//     told apart from one that is complete.
//
// `realm_history_state` is one row per realm that a history-aware process has
// mounted: whether it recorded when last mounted (a realm that did not, or has
// no row, has unrecorded changes to take in as a gap), the read-only seal a
// failed recovery leaves, and the lease that keeps two replicas from
// recovering the realm at once. It stays off `realm_metadata` so the archived
// filters there never have to tell a read-only realm from an archived one:
// read-only realms keep serving reads.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE realm_history_revisions
      ALTER COLUMN revision DROP NOT NULL,
      ALTER COLUMN parent DROP NOT NULL,
      ADD COLUMN IF NOT EXISTS state varchar NOT NULL DEFAULT 'committed',
      ADD COLUMN IF NOT EXISTS paths text[] NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS kind varchar NOT NULL DEFAULT 'write',
      ADD COLUMN IF NOT EXISTS post_committed_at timestamptz
  `);
  // Rows journaled before this column existed were indexed by the write that
  // materialized them.
  pgm.sql(`
    UPDATE realm_history_revisions SET post_committed_at = materialized_at
    WHERE post_committed_at IS NULL AND materialized_at IS NOT NULL
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS realm_history_revisions_pending
      ON realm_history_revisions (realm_url, seq)
      WHERE state = 'pending'
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS realm_history_revisions_not_post_committed
      ON realm_history_revisions (realm_url, seq)
      WHERE post_committed_at IS NULL
  `);
  // History order is read from each revision's parent, and the newest
  // revision is the one no other names as its parent.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS realm_history_revisions_parent
      ON realm_history_revisions (realm_url, parent)
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS realm_history_state (
      realm_url varchar PRIMARY KEY,
      recording boolean NOT NULL,
      recording_changed_at timestamptz NOT NULL DEFAULT now(),
      read_only_at timestamptz,
      read_only_reason varchar,
      read_only_detail text,
      recovery_lease_owner varchar,
      recovery_lease_until timestamptz,
      last_recovered_at timestamptz,
      last_recovery_outcome varchar
    )
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS realm_history_state`);
  pgm.sql(`DROP INDEX IF EXISTS realm_history_revisions_parent`);
  pgm.sql(`DROP INDEX IF EXISTS realm_history_revisions_not_post_committed`);
  pgm.sql(`DROP INDEX IF EXISTS realm_history_revisions_pending`);
  pgm.sql(`
    ALTER TABLE realm_history_revisions
      DROP COLUMN IF EXISTS post_committed_at,
      DROP COLUMN IF EXISTS kind,
      DROP COLUMN IF EXISTS paths,
      DROP COLUMN IF EXISTS state
  `);
};

// The change journal and the realm-historian's state: the tables behind realm
// revision history. The realm server writes one `realm_change_events` row per
// write, in the same transaction as the write's `realm_file_meta` update, and
// realm-historian turns those rows into git revisions after the fact. Nothing
// on the write path waits on a revision.
//
// `realm_change_events` is the journal. `seq` orders a realm's events; `xid`
// is the inserting transaction's id, so a reader can take only rows whose
// transaction is older than every transaction still in progress
// (`pg_snapshot_xmin(pg_current_snapshot())`), reading in `(xid, seq)` order
// from a position kept the same way, and never skip a row whose transaction
// was still open when a later one became visible. The `xid8` type and
// `pg_current_xact_id()` need Postgres 13 or later.
// `author` is the effective authenticated user's Matrix id, or `boxel-system`
// for a write with none. `changes` holds one entry per path:
// `{ path, status, contentHash, size, appended }`. `intent` marks an event
// that names its own revision: a revert, a scan or a realm deletion.
//
// `realm_change_event_paths` holds each event's paths, keyed by realm and
// path, so the writes not yet recorded under a path can be found with an
// indexed prefix query.
//
// `realm_history_state` is realm-historian's cursor per realm, and the
// per-realm `enabled` flag the realm server reads before writing an event.
// `realm_history_path_state` is the fingerprint, size and git object of each
// path at the realm's recorded HEAD, which realm-historian reconciles against
// `realm_file_meta`. `realm_historian_leases` holds one lease per virtual
// shard, so one realm-historian task records a realm at a time.
//
// All five are server-only, and excluded from the SQLite schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS realm_change_events (
      seq bigserial PRIMARY KEY,
      realm_id uuid NOT NULL,
      realm_url text NOT NULL,
      occurred_at timestamptz NOT NULL DEFAULT now(),
      xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
      author text NOT NULL,
      channel text NOT NULL,
      agent text,
      room text,
      operation_id text,
      correlation_id text,
      partial boolean NOT NULL DEFAULT false,
      push_id text,
      push_final boolean NOT NULL DEFAULT false,
      intent jsonb,
      changes jsonb NOT NULL
    )
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS realm_change_events_realm_seq_idx
      ON realm_change_events (realm_id, seq)
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS realm_change_events_xid_seq_idx
      ON realm_change_events (xid, seq)
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS realm_change_event_paths (
      realm_id uuid NOT NULL,
      path text NOT NULL,
      seq bigint NOT NULL,
      PRIMARY KEY (realm_id, path, seq)
    )
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS realm_change_event_paths_prefix_idx
      ON realm_change_event_paths (realm_id, path text_pattern_ops)
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS realm_history_state (
      realm_id uuid PRIMARY KEY,
      enabled boolean NOT NULL DEFAULT false,
      cursor_seq bigint NOT NULL DEFAULT 0,
      head text,
      recorded_at timestamptz,
      status text NOT NULL DEFAULT 'ok',
      stalled_reason text,
      CONSTRAINT realm_history_state_status_check CHECK (status IN ('ok', 'stalled'))
    )
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS realm_history_path_state (
      realm_id uuid NOT NULL,
      path text NOT NULL,
      content_hash text NOT NULL,
      size bigint NOT NULL,
      object_id text NOT NULL,
      PRIMARY KEY (realm_id, path)
    )
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS realm_historian_leases (
      shard text PRIMARY KEY,
      holder text NOT NULL,
      expires_at timestamptz NOT NULL
    )
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS realm_historian_leases`);
  pgm.sql(`DROP TABLE IF EXISTS realm_history_path_state`);
  pgm.sql(`DROP TABLE IF EXISTS realm_history_state`);
  pgm.sql(`DROP TABLE IF EXISTS realm_change_event_paths`);
  pgm.sql(`DROP TABLE IF EXISTS realm_change_events`);
};

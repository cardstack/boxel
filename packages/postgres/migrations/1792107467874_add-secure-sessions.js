// Sessions signed in on the secure origin: the secure window's own session,
// and the one the CLI receives through it. A realm-server session that names
// one of these rows carries the `secureSession` claim, which minting a key
// write ticket requires. The claim is only honoured while its row exists and
// hasn't expired, so signing out deletes the row.
//
// `sign_in_proof` records what signed the user in: the Matrix user-interactive
// auth session their password completed (`uia:…`), or the SHA-256 of the
// authorization code Google sent to the secure origin (`google:…`). It is
// unique, so one proof signs in once. Signing out expires a row rather than
// deleting it, and rows are swept only well after they expire, so a proof
// can't sign in again after its session ends.
//
// The table is withheld from the read-only role used by dashboards and
// read-only database access, and from every role that is a member of it, in
// case one was also granted SELECT directly. That role exists only where it
// was provisioned (staging and production), so the revoke is skipped wherever
// it doesn't. Every statement is idempotent, so running `up` again changes
// nothing.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS secure_sessions (
      id uuid PRIMARY KEY,
      -- The Matrix user id the session belongs to.
      user_id varchar NOT NULL,
      -- 'window' for the secure window's own session, 'cli' for the CLI's.
      client varchar NOT NULL,
      sign_in_proof varchar NOT NULL,
      created_at timestamptz NOT NULL DEFAULT NOW(),
      expires_at timestamptz NOT NULL,
      CONSTRAINT secure_sessions_sign_in_proof_key UNIQUE (sign_in_proof),
      CONSTRAINT secure_sessions_client_check CHECK (client IN ('window', 'cli'))
    )
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS secure_sessions_expires_at_idx
      ON secure_sessions (expires_at)
  `);
  pgm.sql(`
    DO $$
    DECLARE
      member_name name;
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_role') THEN
        REVOKE SELECT ON TABLE secure_sessions FROM readonly_role;
        FOR member_name IN
          SELECT member.rolname
          FROM pg_auth_members membership
          JOIN pg_roles grp ON grp.oid = membership.roleid
          JOIN pg_roles member ON member.oid = membership.member
          WHERE grp.rolname = 'readonly_role'
        LOOP
          EXECUTE format(
            'REVOKE SELECT ON TABLE secure_sessions FROM %I',
            member_name
          );
        END LOOP;
      END IF;
    END
    $$
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS secure_sessions`);
};

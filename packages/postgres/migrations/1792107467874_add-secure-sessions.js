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
// read-only database access, and from every role that reads as a member of it
// (granted the role with INHERIT or SET), in case one was also granted SELECT
// directly. A role that only administers the membership isn't one: on
// Postgres 16 the role that created the read-only role is an ADMIN-only member
// of it, and is often the table's owner, whose own privileges are left alone.
// The migration fails if any of those roles can still read the table. That role exists only where it
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
      readable_by name;
      readable_column name;
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_role') THEN
        REVOKE SELECT ON TABLE secure_sessions FROM readonly_role;
        FOR member_name IN
          SELECT member.rolname
          FROM pg_auth_members membership
          JOIN pg_roles grp ON grp.oid = membership.roleid
          JOIN pg_roles member ON member.oid = membership.member
          WHERE grp.rolname = 'readonly_role'
            AND (membership.inherit_option OR membership.set_option)
            AND membership.member <> (
              SELECT relowner FROM pg_class
              WHERE oid = 'secure_sessions'::regclass
            )
        LOOP
          EXECUTE format(
            'REVOKE SELECT ON TABLE secure_sessions FROM %I',
            member_name
          );
        END LOOP;

        -- The revokes above remove only grants this role made, and SELECT
        -- granted to PUBLIC or to another role a member belongs to still
        -- reads. So check every column against readonly_role and every role
        -- that inherits its privileges or can SET ROLE to it, directly or
        -- through other roles, and stop if any can read one. The table's
        -- owner reads it by owning it, so it isn't checked.
        WITH RECURSIVE reader (oid) AS (
          SELECT oid FROM pg_roles WHERE rolname = 'readonly_role'
          UNION
          SELECT membership.member
          FROM pg_auth_members membership
          JOIN reader ON reader.oid = membership.roleid
          WHERE membership.inherit_option OR membership.set_option
        )
        SELECT reader_role.rolname, col.attname
          INTO readable_by, readable_column
          FROM reader
          JOIN pg_roles reader_role ON reader_role.oid = reader.oid
          CROSS JOIN pg_class tbl
          JOIN pg_attribute col ON col.attrelid = tbl.oid
          WHERE tbl.oid = to_regclass('secure_sessions')
            AND reader.oid <> tbl.relowner
            AND col.attnum > 0
            AND NOT col.attisdropped
            AND has_column_privilege(reader.oid, tbl.oid, col.attnum, 'SELECT')
          ORDER BY reader_role.rolname, col.attnum
          LIMIT 1;
        IF FOUND THEN
          RAISE EXCEPTION
            '% can read secure_sessions.%, which is withheld from readonly_role and the roles that read through it',
            readable_by, readable_column
            USING HINT = format(
              'Revoke the grant or role membership that lets %I read secure_sessions.%I, then run the migration again.',
              readable_by, readable_column
            );
        END IF;
      END IF;
    END
    $$
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS secure_sessions`);
};

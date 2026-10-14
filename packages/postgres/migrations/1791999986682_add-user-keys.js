// Keys that belong to people, and the tickets that authorize writing a key's
// value.
//
// `user_keys` holds one row per key. The value is sealed by the realm server's
// secrets-at-rest helper (AES-256-GCM: ciphertext, nonce, tag and the id of
// the data key that sealed it), bound to the field `user_keys.value`, the
// owner, the row's id and, once it has one, the destination. No plain-text
// value is ever stored. `destination` is null for a key added with no
// operation in hand; setting it later re-seals the value.
//
// `key_write_tickets` holds the short-lived, single-use tickets that adding,
// replacing or deleting a key must present. Only a ticket's SHA-256 is stored;
// a change consumes its ticket by deleting the row.
//
// Both tables are withheld from the read-only role used by dashboards and
// read-only database access, and from every role that is a member of it, in
// case one was also granted SELECT directly. That role exists only where it
// was provisioned (staging and production), so the revoke is skipped wherever
// it doesn't. Every statement is idempotent, so running `up` again changes
// nothing.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS user_keys (
      id uuid PRIMARY KEY,
      -- The Matrix user id of the key's owner.
      owner varchar NOT NULL,
      -- A label for people, unique among the owner's keys.
      name varchar NOT NULL,
      kind varchar NOT NULL,
      destination varchar,
      placement_hints jsonb,
      state varchar NOT NULL,
      value_ciphertext bytea NOT NULL,
      value_nonce bytea NOT NULL,
      value_tag bytea NOT NULL,
      value_key_id varchar NOT NULL,
      created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW(),
      CONSTRAINT user_keys_owner_name_key UNIQUE (owner, name)
    )
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS key_write_tickets (
      ticket_sha256 varchar PRIMARY KEY,
      owner varchar NOT NULL,
      expires_at timestamptz NOT NULL
    )
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS key_write_tickets_expires_at_idx
      ON key_write_tickets (expires_at)
  `);
  pgm.sql(`
    DO $$
    DECLARE
      member_name name;
      table_name text;
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_role') THEN
        FOREACH table_name IN ARRAY ARRAY['user_keys', 'key_write_tickets']
        LOOP
          EXECUTE format('REVOKE SELECT ON TABLE %I FROM readonly_role', table_name);
          FOR member_name IN
            SELECT member.rolname
            FROM pg_auth_members membership
            JOIN pg_roles grp ON grp.oid = membership.roleid
            JOIN pg_roles member ON member.oid = membership.member
            WHERE grp.rolname = 'readonly_role'
          LOOP
            EXECUTE format(
              'REVOKE SELECT ON TABLE %I FROM %I',
              table_name,
              member_name
            );
          END LOOP;
        END LOOP;
      END IF;
    END
    $$
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS key_write_tickets`);
  pgm.sql(`DROP TABLE IF EXISTS user_keys`);
};

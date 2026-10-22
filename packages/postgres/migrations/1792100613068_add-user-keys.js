// Keys that belong to people, and the tickets that authorize writing a key's
// value.
//
// `user_keys` holds one row per key. The value is sealed by the realm server's
// secrets-at-rest helper (AES-256-GCM: ciphertext, nonce, tag and the id of
// the data key that sealed it), bound to the field `user_keys.value`, the
// owner and the row's id. No plain-text value is ever stored. A key records no
// destination.
//
// `key_write_tickets` holds the short-lived, single-use tickets that adding,
// replacing or deleting a key must present. Each is minted for one change:
// `action` is `add`, `replace` or `delete`, and `key_id` names the key a
// replace or delete changes (null for an add). Only a ticket's SHA-256 is
// stored; a change consumes its ticket by deleting the row.
//
// Both tables are withheld from the read-only role used by dashboards and
// read-only database access, and from every role that is a member of it, in
// case one was also granted SELECT directly. That role exists only where it
// was provisioned (staging and production), so the revoke is skipped wherever
// it doesn't. Every statement is idempotent, so running `up` again changes
// nothing.
//
// A member of the read-only role is a role granted it with INHERIT or SET,
// directly or through other roles granted that way, so one that reads with the
// role's privileges. A role that only administers the membership isn't one: on
// Postgres 16 a role with CREATEROLE that creates the read-only role is made an
// ADMIN-only member of it, and that role is often their owner. A table's owner
// is never treated as a member, so its own privileges are left alone.
//
// A role holding SELECT with the grant option can pass SELECT on, and a
// REVOKE removes only the grants its grantor made. So `up` revokes each SELECT
// grant those roles hold on a table or its columns acting as the role that
// made it, with CASCADE, which also removes every grant passed on from it.
// CASCADE on a table grant leaves the column grants passed on from it, so
// column grants are revoked first. Within each, grants a table's owner made go
// first, so a grant one reader passed on to another goes with the grant it
// came from. Acting as another role needs the migrating role to be a superuser or able
// to SET ROLE to it; where it isn't, `up` stops and names the grant rather
// than leave the table readable. Only grants a reader holds itself are
// revoked: a reader that can read a table through PUBLIC or through a role
// outside the read-only role keeps that access.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS user_keys (
      id uuid PRIMARY KEY,
      -- The Matrix user id of the key's owner.
      owner varchar NOT NULL,
      -- A label for people, unique among the owner's keys.
      name varchar NOT NULL,
      kind varchar NOT NULL,
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
      action varchar NOT NULL,
      key_id uuid,
      expires_at timestamptz NOT NULL,
      CONSTRAINT key_write_tickets_action_key_id_check CHECK (
        (action = 'add' AND key_id IS NULL)
        OR (action IN ('replace', 'delete') AND key_id IS NOT NULL)
      )
    )
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS key_write_tickets_expires_at_idx
      ON key_write_tickets (expires_at)
  `);
  pgm.sql(`
    DO $$
    DECLARE
      migrating_role name := current_user;
      table_name text;
      grantor_name name;
      grantee_name name;
      revoked_grantor oid;
      revoked_grantee oid;
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_role') THEN
        FOREACH table_name IN ARRAY ARRAY['user_keys', 'key_write_tickets']
        LOOP
          LOOP
            -- One SELECT grant the read-only role or a member of it still
            -- holds on the table or one of its columns. A grant the table's
            -- owner made has no grantor name.
            SELECT
              CASE WHEN held.grantor <> held.relowner
                THEN grantor_role.rolname END,
              grantee_role.rolname,
              held.grantor,
              held.grantee
            INTO grantor_name, grantee_name, revoked_grantor, revoked_grantee
            FROM (
              SELECT tbl.relowner, true AS on_table, acl.*
              FROM pg_class tbl
              CROSS JOIN LATERAL aclexplode(tbl.relacl) acl
              WHERE tbl.oid = table_name::regclass
              UNION ALL
              SELECT tbl.relowner, false AS on_table, acl.*
              FROM pg_class tbl
              JOIN pg_attribute col ON col.attrelid = tbl.oid
              CROSS JOIN LATERAL aclexplode(col.attacl) acl
              WHERE tbl.oid = table_name::regclass
                AND col.attnum > 0
                AND NOT col.attisdropped
            ) held
            JOIN pg_roles grantor_role ON grantor_role.oid = held.grantor
            JOIN pg_roles grantee_role ON grantee_role.oid = held.grantee
            WHERE held.privilege_type = 'SELECT'
              AND grantee_role.oid <> held.relowner
              AND grantee_role.oid IN (
                WITH RECURSIVE reader(oid) AS (
                  SELECT oid FROM pg_roles WHERE rolname = 'readonly_role'
                  UNION
                  SELECT membership.member
                  FROM pg_auth_members membership
                  JOIN reader ON membership.roleid = reader.oid
                  WHERE membership.inherit_option OR membership.set_option
                )
                SELECT oid FROM reader
              )
            -- Column grants come first, since revoking a table grant leaves
            -- the column grants passed on from it. Then grants the owner
            -- made, so CASCADE takes what a reader passed on from one without
            -- acting as that reader.
            ORDER BY held.on_table, held.grantor <> held.relowner
            LIMIT 1;
            EXIT WHEN NOT FOUND;
            IF grantor_name IS NOT NULL THEN
              BEGIN
                EXECUTE format('SET ROLE %I', grantor_name);
              EXCEPTION WHEN insufficient_privilege THEN
                RAISE EXCEPTION
                  'cannot revoke the SELECT on % that % granted to %',
                  table_name, grantor_name, grantee_name
                  USING HINT = format(
                    'Run the migration as a superuser or as a role that can SET ROLE %I.',
                    grantor_name
                  );
              END;
            END IF;
            EXECUTE format(
              'REVOKE SELECT ON TABLE %I FROM %I CASCADE',
              table_name,
              grantee_name
            );
            EXECUTE format('SET ROLE %I', migrating_role);
            IF EXISTS (
              SELECT 1
              FROM pg_class tbl
              CROSS JOIN LATERAL aclexplode(tbl.relacl) acl
              WHERE tbl.oid = table_name::regclass
                AND acl.privilege_type = 'SELECT'
                AND acl.grantor = revoked_grantor
                AND acl.grantee = revoked_grantee
              UNION ALL
              SELECT 1
              FROM pg_attribute col
              CROSS JOIN LATERAL aclexplode(col.attacl) acl
              WHERE col.attrelid = table_name::regclass
                AND acl.privilege_type = 'SELECT'
                AND acl.grantor = revoked_grantor
                AND acl.grantee = revoked_grantee
            ) THEN
              RAISE EXCEPTION 'the SELECT on % that % granted to % survived its REVOKE',
                table_name, COALESCE(grantor_name, 'the owner'), grantee_name;
            END IF;
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

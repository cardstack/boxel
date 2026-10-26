// Grants: where a user's key may be sent. A key holds its secret and nothing
// about where it goes; each destination its owner approves for it is a grant,
// one row here, and a key has as many grants as destinations it may be sent
// to.
//
// `user_key_grants` holds one row per key and destination. `destination` is
// the normalized destination, the URL parser's `href` of an origin and a path
// prefix ending in `/`, unique per key. `owner` is the key's owner, who
// approved the grant. `state` is `active`. `approved_via` is `window` or `cli`:
// the client of the secure-origin session that approved it.
//
// Each grant holds its own sealed copy of the key's secret (`value_*`), sealed
// by the realm server's secrets-at-rest helper and bound to the field
// `user_key_grants.value`, the owner, the grant's id, the key's id and the
// destination. A grant row written by anything but the realm server, or one
// whose key or destination is edited afterwards, has no copy that opens, so it
// sends nothing. Grants go with their key: deleting the key deletes them.
//
// The table is withheld from the read-only role used by dashboards and
// read-only database access, as `user_keys` is, and from every role that reads
// with its privileges: one granted it with INHERIT or SET, directly or through
// other roles granted that way. A role that only administers the membership
// isn't one, and the table's owner is never treated as one, so its own
// privileges are left alone.
//
// A REVOKE removes only the grants its grantor made, so `up` revokes each
// SELECT grant those roles hold on the table or its columns acting as the role
// that made it, with CASCADE. Column grants go first, since CASCADE on a table
// grant leaves the column grants passed on from it, and within each level the
// grants the table's owner made go first. Where the migrating role can't act
// as a grant's grantor, `up` stops and names the grant rather than leave the
// table readable. SELECT through PUBLIC, or through a role outside the
// read-only role, still lets a reader read, and revoking it isn't a
// migration's call, so `up` then asks `has_column_privilege` about every
// column for each reader and stops, naming the role and the column, if any of
// them can still read one.
//
// `readonly_role` exists only where it was provisioned (staging and
// production), so both steps are skipped wherever it doesn't. Every statement
// is idempotent, so running `up` again changes nothing.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS user_key_grants (
      id uuid PRIMARY KEY,
      key_id uuid NOT NULL REFERENCES user_keys (id) ON DELETE CASCADE,
      -- The Matrix user id of the key's owner, who approved the grant.
      owner varchar NOT NULL,
      destination varchar NOT NULL,
      state varchar NOT NULL,
      approved_at timestamptz NOT NULL DEFAULT NOW(),
      approved_via varchar NOT NULL,
      value_ciphertext bytea NOT NULL,
      value_nonce bytea NOT NULL,
      value_tag bytea NOT NULL,
      value_key_id varchar NOT NULL,
      CONSTRAINT user_key_grants_key_id_destination_key UNIQUE (key_id, destination),
      CONSTRAINT user_key_grants_state_check CHECK (state = 'active'),
      CONSTRAINT user_key_grants_approved_via_check CHECK (approved_via IN ('window', 'cli'))
    )
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS user_key_grants_owner_idx
      ON user_key_grants (owner)
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
        FOREACH table_name IN ARRAY ARRAY['user_key_grants']
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
            -- Column grants come before table grants: CASCADE on a table
            -- grant leaves the column grants passed on from it, and once
            -- their grantor has lost the table grant, nobody can revoke
            -- them. Within each, grants the owner made come first, so
            -- CASCADE takes what a reader passed on from one without acting
            -- as that reader.
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
  pgm.sql(`
    DO $$
    DECLARE
      readable_by name;
      readable_table name;
      readable_column name;
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_role') THEN
        WITH RECURSIVE reader (oid) AS (
          SELECT oid FROM pg_roles WHERE rolname = 'readonly_role'
          UNION
          SELECT membership.member
          FROM pg_auth_members membership
          JOIN reader ON reader.oid = membership.roleid
          WHERE membership.inherit_option OR membership.set_option
        )
        SELECT reader_role.rolname, tbl.relname, col.attname
          INTO readable_by, readable_table, readable_column
          FROM reader
          JOIN pg_roles reader_role ON reader_role.oid = reader.oid
          CROSS JOIN pg_class tbl
          JOIN pg_attribute col ON col.attrelid = tbl.oid
          WHERE tbl.oid = to_regclass('user_key_grants')
            AND reader.oid <> tbl.relowner
            AND col.attnum > 0
            AND NOT col.attisdropped
            AND has_column_privilege(reader.oid, tbl.oid, col.attnum, 'SELECT')
          ORDER BY tbl.relname, reader_role.rolname, col.attnum
          LIMIT 1;
        IF FOUND THEN
          RAISE EXCEPTION
            '% can read %.%, which is withheld from readonly_role and the roles that read through it',
            readable_by, readable_table, readable_column
            USING HINT = format(
              'Revoke the grant or role membership that lets %I read %I.%I, then run the migration again.',
              readable_by, readable_table, readable_column
            );
        END IF;
      END IF;
    END
    $$
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS user_key_grants`);
};

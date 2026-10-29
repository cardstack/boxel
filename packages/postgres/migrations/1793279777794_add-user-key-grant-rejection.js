// Rejected grants: a vendor that answers a key with 401 at a grant's
// destination has refused that key there. The grant is then `rejected`, and
// calls under it are refused without contacting the vendor, except one probe
// per grant per interval. A probe the vendor accepts returns the grant to
// `active`, and replacing the key returns every one of its grants. The key's
// other grants keep working: a vendor can refuse a key at one host and accept
// it at another.
//
// `user_key_grants` gains:
//
// * `state` `rejected`, beside `active`. `rejected_at` is when it entered the
//   state, set exactly while it is rejected.
// * `last_probe_at`: when a call under the rejected grant was last let
//   through to the vendor, so the next probe waits out the interval.
// * `last_forbidden_at` and `last_forbidden_host`: the latest 403 the vendor
//   answered under the grant, which changes no state (a 403 can mean an
//   organization's single sign-on approval, one resource's permissions or a
//   rate limit) but is shown to the key's owner.
//
// `user_key_grant_notices` records the one notice sent when a grant becomes
// rejected, one row per recipient: the key's owner, and, when the call came
// through a share, each direct writer of the share's realm. It names the key
// and the destination, copied, so it still reads after the key is renamed.
//
// The notices table holds no secret, but like the other key tables it is
// withheld from the read-only role and from every role that reads with its
// privileges, by the same steps the grants migration takes, and excluded from
// the SQLite schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE user_key_grants
      ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
      ADD COLUMN IF NOT EXISTS last_probe_at timestamptz,
      ADD COLUMN IF NOT EXISTS last_forbidden_at timestamptz,
      ADD COLUMN IF NOT EXISTS last_forbidden_host varchar
  `);
  pgm.sql(`
    ALTER TABLE user_key_grants DROP CONSTRAINT IF EXISTS user_key_grants_state_check
  `);
  pgm.sql(`
    ALTER TABLE user_key_grants ADD CONSTRAINT user_key_grants_state_check CHECK (
      (state = 'active' AND rejected_at IS NULL)
      OR (state = 'rejected' AND rejected_at IS NOT NULL)
    )
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS user_key_grant_notices (
      id bigserial PRIMARY KEY,
      grant_id uuid NOT NULL REFERENCES user_key_grants (id) ON DELETE CASCADE,
      key_id uuid NOT NULL,
      key_name varchar NOT NULL,
      destination varchar NOT NULL,
      -- The Matrix user id the notice is for.
      recipient varchar NOT NULL,
      -- The key's owner.
      owner varchar NOT NULL,
      -- The realm and share the rejected call came through, for a share.
      realm_url varchar,
      share_id uuid,
      reason varchar NOT NULL,
      created_at timestamptz NOT NULL DEFAULT NOW(),
      CONSTRAINT user_key_grant_notices_reason_check CHECK (reason = 'credential-rejected')
    )
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS user_key_grant_notices_recipient_idx
      ON user_key_grant_notices (recipient, created_at)
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
        FOREACH table_name IN ARRAY ARRAY['user_key_grant_notices']
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
          WHERE tbl.oid = to_regclass('user_key_grant_notices')
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
  pgm.sql(`DROP TABLE IF EXISTS user_key_grant_notices`);
  pgm.sql(
    `UPDATE user_key_grants SET state = 'active' WHERE state = 'rejected'`,
  );
  pgm.sql(`
    ALTER TABLE user_key_grants DROP CONSTRAINT IF EXISTS user_key_grants_state_check
  `);
  pgm.sql(`
    ALTER TABLE user_key_grants ADD CONSTRAINT user_key_grants_state_check CHECK (state = 'active')
  `);
  pgm.sql(`
    ALTER TABLE user_key_grants
      DROP COLUMN IF EXISTS rejected_at,
      DROP COLUMN IF EXISTS last_probe_at,
      DROP COLUMN IF EXISTS last_forbidden_at,
      DROP COLUMN IF EXISTS last_forbidden_host
  `);
};

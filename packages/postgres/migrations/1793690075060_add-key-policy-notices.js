// One row per notice a key's owner is owed because a realm's policy came to
// open their share there to people who aren't signed in: a confirmed save of
// the policy card a realm names, or of the realm's `realm.json` pointing at
// another one, whose audit listed the share (`policy-share-audit.ts` in the
// realm server).
//
// `reason` says which kind of notice it is. `visitors-use` is for a key that
// allows anonymous use, which visitors start using as soon as the policy is
// saved. `visitors-wanted` is for one that doesn't: it refuses them until its
// owner allows it on the key. `operations` are the operations the policy
// opened that are bound to the share, each as `<module>#<export>.<operation>`.
// `saved_by` is who saved the policy, null when the realm server can't say.
//
// The owner reads their own notices, newest first. Deleting the share deletes
// its notices; deleting the key keeps them, without the key.
//
// The table holds no secret, but like the other key tables it is withheld
// from the read-only role and from every role that reads with its privileges,
// by the same steps the grants migration takes, and excluded from the SQLite
// schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS key_policy_notices (
      id bigserial PRIMARY KEY,
      owner varchar NOT NULL,
      share_id uuid NOT NULL REFERENCES key_shares (id) ON DELETE CASCADE,
      key_id uuid REFERENCES user_keys (id) ON DELETE SET NULL,
      realm_url varchar NOT NULL,
      label varchar NOT NULL,
      policy_card varchar,
      saved_by varchar,
      reason varchar NOT NULL,
      operations jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT NOW(),
      CONSTRAINT key_policy_notices_reason_check CHECK (reason IN ('visitors-use', 'visitors-wanted'))
    )
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS key_policy_notices_owner_idx
      ON key_policy_notices (owner, created_at)
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
        FOREACH table_name IN ARRAY ARRAY['key_policy_notices']
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
          WHERE tbl.oid = to_regclass('key_policy_notices')
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
  pgm.sql(`DROP TABLE IF EXISTS key_policy_notices`);
};

// Repairs how the read-only role used by dashboards and read-only database
// access is withheld from the tables that hold secrets and keys
// (`proxy_endpoints`, `incoming_webhooks`, `user_keys` and
// `key_write_tickets`) on a database where the migrations that withhold them
// have already run. That role exists only where it was provisioned (staging
// and production), so the repair is skipped wherever it doesn't, and so is any
// of those tables that doesn't exist.
//
// The table's owner gets SELECT back where its own ACL entry lacks it. On
// Postgres 16 a role with CREATEROLE that creates the read-only role is made
// an ADMIN-only member of it, and that role is often the tables' owner, so a
// withholding pass that counted every member of the read-only role as a
// reader revoked the owner's own SELECT.
//
// Then every SELECT grant a reader holds on the table or its columns is
// revoked. The readers are the read-only role and every role that reaches it
// through memberships granted with INHERIT or SET, directly or through other
// roles; the table's owner is never one. A REVOKE removes only the grants its
// grantor made, so each grant is revoked acting as the role that made it, with
// CASCADE, which also removes every grant passed on from it. Acting as another
// role needs the migrating role to be a superuser or able to SET ROLE to it;
// where it isn't, `up` stops and names the grant rather than leave the table
// readable.
//
// Before revoking, `up` takes every SELECT grant on the table and its
// columns, and records the ones the revokes removed, including those CASCADE
// took from roles that aren't readers: who made each grant (none for the
// table's owner), to whom (none for PUBLIC), on which column (none for the
// whole table) and whether it carried the grant option, as the table's row in
// `readonly_role_repaired_select_grants`. A second `up` keeps the first
// record. `down` grants back exactly the recorded grants, each acting as the
// role that made it once that role itself holds the grant option again, and
// drops the record. It leaves the owner's SELECT in place: an owner that can't
// read its own table is the fault this repairs, not a state to return to.

exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    DECLARE
      migrating_role name := current_user;
      -- Every SELECT grant on the table ($1) and on its columns, as a JSON
      -- array. A grant the table's owner made has no grantor, and one to
      -- PUBLIC has no grantee.
      snapshot text := $snapshot$
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'grantor', CASE WHEN select_grant.grantor <> select_grant.relowner
                THEN grantor_role.rolname END,
              'grantee', grantee_role.rolname,
              'column', select_grant.column_name,
              'grantable', select_grant.is_grantable
            )
            ORDER BY grantee_role.rolname NULLS FIRST,
              select_grant.column_name NULLS FIRST,
              grantor_role.rolname
          ),
          '[]'::jsonb
        )
        FROM (
          SELECT NULL::name AS column_name, tbl.relowner, acl.*
          FROM pg_class tbl
          CROSS JOIN LATERAL aclexplode(tbl.relacl) acl
          WHERE tbl.oid = $1
          UNION ALL
          SELECT col.attname, tbl.relowner, acl.*
          FROM pg_class tbl
          JOIN pg_attribute col ON col.attrelid = tbl.oid
          CROSS JOIN LATERAL aclexplode(col.attacl) acl
          WHERE tbl.oid = $1
            AND col.attnum > 0
            AND NOT col.attisdropped
        ) select_grant
        JOIN pg_roles grantor_role ON grantor_role.oid = select_grant.grantor
        LEFT JOIN pg_roles grantee_role ON grantee_role.oid = select_grant.grantee
        WHERE select_grant.privilege_type = 'SELECT'
      $snapshot$;
      withheld_table text;
      table_oid oid;
      owner_name name;
      readers name[];
      before_revoke jsonb;
      remaining jsonb;
      withheld jsonb;
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_role') THEN
        RETURN;
      END IF;
      CREATE TABLE IF NOT EXISTS readonly_role_repaired_select_grants (
        table_name text PRIMARY KEY,
        grants jsonb NOT NULL
      );
      FOREACH withheld_table IN ARRAY ARRAY[
        'proxy_endpoints',
        'incoming_webhooks',
        'user_keys',
        'key_write_tickets'
      ]
      LOOP
        table_oid := to_regclass(withheld_table);
        CONTINUE WHEN table_oid IS NULL;
        SELECT pg_get_userbyid(relowner) INTO owner_name
          FROM pg_class WHERE oid = table_oid;

        -- A table with no ACL gives its owner every privilege by default.
        IF EXISTS (
          SELECT 1 FROM pg_class WHERE oid = table_oid AND relacl IS NOT NULL
        ) AND NOT EXISTS (
          SELECT 1
          FROM pg_class tbl
          CROSS JOIN LATERAL aclexplode(tbl.relacl) acl
          WHERE tbl.oid = table_oid
            AND acl.grantee = tbl.relowner
            AND acl.grantor = tbl.relowner
            AND acl.privilege_type = 'SELECT'
        ) THEN
          EXECUTE format(
            'GRANT SELECT ON TABLE %I TO %I',
            withheld_table,
            owner_name
          );
        END IF;

        WITH RECURSIVE reader(oid) AS (
          SELECT oid FROM pg_roles WHERE rolname = 'readonly_role'
          UNION
          SELECT membership.member
          FROM pg_auth_members membership
          JOIN reader ON membership.roleid = reader.oid
          WHERE membership.inherit_option OR membership.set_option
        )
        SELECT COALESCE(array_agg(reader_role.rolname), '{}') INTO readers
          FROM reader
          JOIN pg_roles reader_role ON reader_role.oid = reader.oid
          WHERE reader_role.rolname <> owner_name;

        EXECUTE snapshot INTO before_revoke USING table_oid;
        remaining := before_revoke;
        LOOP
          withheld := NULL;
          SELECT held INTO withheld
            FROM jsonb_array_elements(remaining) held
            WHERE held->>'grantee' = ANY (readers)
            LIMIT 1;
          EXIT WHEN withheld IS NULL;
          IF withheld->>'grantor' IS NOT NULL THEN
            BEGIN
              EXECUTE format('SET ROLE %I', withheld->>'grantor');
            EXCEPTION WHEN insufficient_privilege THEN
              RAISE EXCEPTION
                'cannot revoke the SELECT on % that % granted to %',
                withheld_table, withheld->>'grantor', withheld->>'grantee'
                USING HINT = format(
                  'Run the migration as a superuser or as a role that can SET ROLE %I.',
                  withheld->>'grantor'
                );
            END;
          END IF;
          EXECUTE format(
            'REVOKE SELECT ON TABLE %I FROM %I CASCADE',
            withheld_table,
            withheld->>'grantee'
          );
          EXECUTE format('SET ROLE %I', migrating_role);
          EXECUTE snapshot INTO remaining USING table_oid;
          IF EXISTS (
            SELECT 1 FROM jsonb_array_elements(remaining) held
            WHERE held->'grantor' = withheld->'grantor'
              AND held->'grantee' = withheld->'grantee'
          ) THEN
            RAISE EXCEPTION 'the SELECT on % that % granted to % survived its REVOKE',
              withheld_table,
              COALESCE(withheld->>'grantor', 'the owner'),
              withheld->>'grantee';
          END IF;
        END LOOP;

        INSERT INTO readonly_role_repaired_select_grants (table_name, grants)
          SELECT withheld_table,
            COALESCE(jsonb_agg(revoked ORDER BY position), '[]'::jsonb)
          FROM jsonb_array_elements(before_revoke)
            WITH ORDINALITY AS before_grant(revoked, position)
          WHERE NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(remaining) held
            WHERE held = revoked
          )
          ON CONFLICT (table_name) DO NOTHING;
      END LOOP;
    END
    $$
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DO $$
    DECLARE
      migrating_role name := current_user;
      recorded record;
      table_oid oid;
      pending jsonb;
      waiting jsonb;
      revoked jsonb;
      restored boolean;
    BEGIN
      IF to_regclass('readonly_role_repaired_select_grants') IS NULL THEN
        RETURN;
      END IF;
      FOR recorded IN
        DELETE FROM readonly_role_repaired_select_grants
          RETURNING table_name AS withheld_table, grants
      LOOP
        table_oid := to_regclass(recorded.withheld_table);
        CONTINUE WHEN table_oid IS NULL;
        -- A grant another role made is restored acting as that role, which
        -- needs that role to hold the grant option again, possibly from a
        -- recorded grant still waiting. So each pass restores every grant
        -- whose grantor can make it, until a pass restores nothing.
        pending := recorded.grants;
        LOOP
          waiting := '[]'::jsonb;
          restored := false;
          FOR revoked IN SELECT jsonb_array_elements(pending)
          LOOP
            IF revoked->>'grantee' IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM pg_roles WHERE rolname = revoked->>'grantee'
            ) THEN
              CONTINUE;
            END IF;
            IF revoked->>'column' IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM pg_attribute
              WHERE attrelid = table_oid
                AND attname = revoked->>'column'
                AND NOT attisdropped
            ) THEN
              CONTINUE;
            END IF;
            IF revoked->>'grantor' IS NOT NULL THEN
              IF NOT EXISTS (
                SELECT 1 FROM pg_roles WHERE rolname = revoked->>'grantor'
              ) THEN
                CONTINUE;
              END IF;
              -- The grantor's own entry, not an option it inherits through
              -- another role: granting on an inherited option records that
              -- other role as the grantor.
              IF NOT EXISTS (
                SELECT 1
                FROM pg_class tbl
                CROSS JOIN LATERAL aclexplode(tbl.relacl) acl
                WHERE tbl.oid = table_oid
                  AND acl.grantee = (revoked->>'grantor')::regrole
                  AND acl.privilege_type = 'SELECT'
                  AND acl.is_grantable
                UNION ALL
                SELECT 1
                FROM pg_attribute col
                CROSS JOIN LATERAL aclexplode(col.attacl) acl
                WHERE col.attrelid = table_oid
                  AND col.attname = revoked->>'column'
                  AND acl.grantee = (revoked->>'grantor')::regrole
                  AND acl.privilege_type = 'SELECT'
                  AND acl.is_grantable
              ) THEN
                waiting := waiting || jsonb_build_array(revoked);
                CONTINUE;
              END IF;
              EXECUTE format('SET ROLE %I', revoked->>'grantor');
            END IF;
            EXECUTE format(
              'GRANT SELECT%s ON TABLE %I TO %s%s',
              CASE WHEN revoked->>'column' IS NOT NULL
                THEN format(' (%I)', revoked->>'column') ELSE '' END,
              recorded.withheld_table,
              COALESCE(quote_ident(revoked->>'grantee'), 'PUBLIC'),
              CASE WHEN (revoked->>'grantable')::boolean
                THEN ' WITH GRANT OPTION' ELSE '' END
            );
            EXECUTE format('SET ROLE %I', migrating_role);
            restored := true;
          END LOOP;
          EXIT WHEN NOT restored OR waiting = '[]'::jsonb;
          pending := waiting;
        END LOOP;
      END LOOP;
      DROP TABLE readonly_role_repaired_select_grants;
    END
    $$
  `);
};

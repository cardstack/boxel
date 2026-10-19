// Adds the columns that hold `proxy_endpoints.api_key` sealed by the realm
// server's secrets-at-rest helper (AES-256-GCM: ciphertext, nonce, tag and
// the id of the data key that sealed it). The plain-text `api_key` column
// stays, kept in step by every write, so the previous code revision keeps
// working against this schema.
//
// The table holds the platform's own vendor keys, so the read-only role used
// by dashboards and read-only database access loses SELECT on it, and so does
// every role that is a member of it, in case one was also granted SELECT
// directly. That role exists only where it was provisioned (staging and
// production), so the revoke is skipped wherever it doesn't. Every statement
// is idempotent, so running `up` again changes nothing.
//
// A member of the read-only role is a role granted it with INHERIT or SET,
// directly or through other roles granted that way, so one that reads with the
// role's privileges. A role that only administers the membership isn't one: on
// Postgres 16 a role with CREATEROLE that creates the read-only role is made an
// ADMIN-only member of it, and that role is often the tables' owner. The
// table's owner is never treated as a member, so its own privileges are left
// alone.
//
// A role holding SELECT with the grant option can pass SELECT on, and a
// REVOKE removes only the grants its grantor made. So `up` revokes each SELECT
// grant those roles hold on the table or its columns acting as the role that
// made it, with CASCADE, which also removes every grant passed on from it.
// Grants the table's owner made go first, so a grant one reader passed on to
// another goes with the grant it came from. Acting as another role needs the migrating role to be a superuser or able
// to SET ROLE to it; where it isn't, `up` stops and names the grant rather
// than leave the table readable. Only grants a reader holds itself are
// revoked: a reader that can read the table through PUBLIC or through a role
// outside the read-only role keeps that access.
//
// Before revoking, `up` takes every SELECT grant on the table and its
// columns, and records the ones the revokes removed, including those CASCADE
// took from roles outside the read-only role: who made each grant (none for
// the table's owner), to whom, on which column (none for the whole table) and
// whether it carried the grant option, as this table's row in
// `readonly_role_revoked_select_grants`. That table is created only where the
// read-only role exists, and a second `up` keeps the first record. `down`
// grants back exactly the recorded grants, each acting as the role that made
// it once that role itself holds the grant option again, so every role ends up
// with the privileges it had before `up`. A database with no record for this
// table gets SELECT back on the read-only role alone. The incoming webhooks
// sealing migration keeps its record the same way, in the same table.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE proxy_endpoints
      ADD COLUMN IF NOT EXISTS api_key_ciphertext bytea,
      ADD COLUMN IF NOT EXISTS api_key_nonce bytea,
      ADD COLUMN IF NOT EXISTS api_key_tag bytea,
      ADD COLUMN IF NOT EXISTS api_key_key_id varchar
  `);
  pgm.sql(`
    DO $$
    DECLARE
      migrating_role name := current_user;
      -- Every SELECT grant on the table and on its columns, as a JSON array.
      -- A grant the table's owner made has no grantor, and one to PUBLIC has
      -- no grantee.
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
          WHERE tbl.oid = 'proxy_endpoints'::regclass
          UNION ALL
          SELECT col.attname, tbl.relowner, acl.*
          FROM pg_class tbl
          JOIN pg_attribute col ON col.attrelid = tbl.oid
          CROSS JOIN LATERAL aclexplode(col.attacl) acl
          WHERE tbl.oid = 'proxy_endpoints'::regclass
            AND col.attnum > 0
            AND NOT col.attisdropped
        ) select_grant
        JOIN pg_roles grantor_role ON grantor_role.oid = select_grant.grantor
        LEFT JOIN pg_roles grantee_role ON grantee_role.oid = select_grant.grantee
        WHERE select_grant.privilege_type = 'SELECT'
      $snapshot$;
      before_revoke jsonb;
      remaining jsonb;
      withheld jsonb;
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_role') THEN
        CREATE TABLE IF NOT EXISTS readonly_role_revoked_select_grants (
          table_name text PRIMARY KEY,
          grants jsonb NOT NULL
        );
        EXECUTE snapshot INTO before_revoke;
        remaining := before_revoke;
        LOOP
          withheld := NULL;
          -- Grants the owner made come first, so CASCADE takes what a reader
          -- passed on from one without acting as that reader.
          SELECT held INTO withheld
            FROM jsonb_array_elements(remaining)
              WITH ORDINALITY AS remaining_grant(held, position)
            WHERE held->>'grantee' IN (
              WITH RECURSIVE reader(oid) AS (
                SELECT oid FROM pg_roles WHERE rolname = 'readonly_role'
                UNION
                SELECT membership.member
                FROM pg_auth_members membership
                JOIN reader ON membership.roleid = reader.oid
                WHERE membership.inherit_option OR membership.set_option
              )
              SELECT reader_role.rolname
              FROM reader
              JOIN pg_roles reader_role ON reader_role.oid = reader.oid
              WHERE reader.oid <> (
                SELECT relowner FROM pg_class WHERE oid = 'proxy_endpoints'::regclass
              )
            )
            ORDER BY held->>'grantor' IS NOT NULL, position
            LIMIT 1;
          EXIT WHEN withheld IS NULL;
          IF withheld->>'grantor' IS NOT NULL THEN
            BEGIN
              EXECUTE format('SET ROLE %I', withheld->>'grantor');
            EXCEPTION WHEN insufficient_privilege THEN
              RAISE EXCEPTION
                'cannot revoke the SELECT on proxy_endpoints that % granted to %',
                withheld->>'grantor', withheld->>'grantee'
                USING HINT = format(
                  'Run the migration as a superuser or as a role that can SET ROLE %I.',
                  withheld->>'grantor'
                );
            END;
          END IF;
          EXECUTE format(
            'REVOKE SELECT ON TABLE proxy_endpoints FROM %I CASCADE',
            withheld->>'grantee'
          );
          EXECUTE format('SET ROLE %I', migrating_role);
          EXECUTE snapshot INTO remaining;
          IF EXISTS (
            SELECT 1 FROM jsonb_array_elements(remaining) held
            WHERE held->'grantor' = withheld->'grantor'
              AND held->'grantee' = withheld->'grantee'
          ) THEN
            RAISE EXCEPTION 'the SELECT on proxy_endpoints that % granted to % survived its REVOKE',
              COALESCE(withheld->>'grantor', 'the owner'), withheld->>'grantee';
          END IF;
        END LOOP;
        INSERT INTO readonly_role_revoked_select_grants (table_name, grants)
          SELECT 'proxy_endpoints',
            COALESCE(jsonb_agg(revoked ORDER BY position), '[]'::jsonb)
          FROM jsonb_array_elements(before_revoke)
            WITH ORDINALITY AS before_grant(revoked, position)
          WHERE NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(remaining) held
            WHERE held = revoked
          )
          ON CONFLICT (table_name) DO NOTHING;
      END IF;
    END
    $$
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DO $$
    DECLARE
      migrating_role name := current_user;
      recorded jsonb;
      pending jsonb;
      waiting jsonb;
      revoked jsonb;
      restored boolean;
    BEGIN
      IF to_regclass('readonly_role_revoked_select_grants') IS NOT NULL THEN
        DELETE FROM readonly_role_revoked_select_grants
          WHERE table_name = 'proxy_endpoints'
          RETURNING grants INTO recorded;
      END IF;
      IF recorded IS NULL THEN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_role') THEN
          GRANT SELECT ON TABLE proxy_endpoints TO readonly_role;
        END IF;
      ELSE
        -- A grant another role made is restored acting as that role, which
        -- needs that role to hold the grant option again, possibly from a
        -- recorded grant still waiting. So each pass restores every grant
        -- whose grantor can make it, until a pass restores nothing.
        pending := recorded;
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
              WHERE attrelid = 'proxy_endpoints'::regclass
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
                WHERE tbl.oid = 'proxy_endpoints'::regclass
                  AND acl.grantee = (revoked->>'grantor')::regrole
                  AND acl.privilege_type = 'SELECT'
                  AND acl.is_grantable
                UNION ALL
                SELECT 1
                FROM pg_attribute col
                CROSS JOIN LATERAL aclexplode(col.attacl) acl
                WHERE col.attrelid = 'proxy_endpoints'::regclass
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
              'GRANT SELECT%s ON TABLE proxy_endpoints TO %s%s',
              CASE WHEN revoked->>'column' IS NOT NULL
                THEN format(' (%I)', revoked->>'column') ELSE '' END,
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
      END IF;
      IF to_regclass('readonly_role_revoked_select_grants') IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM readonly_role_revoked_select_grants) THEN
          DROP TABLE readonly_role_revoked_select_grants;
        END IF;
      END IF;
    END
    $$
  `);
  pgm.sql(`
    ALTER TABLE proxy_endpoints
      DROP COLUMN IF EXISTS api_key_ciphertext,
      DROP COLUMN IF EXISTS api_key_nonce,
      DROP COLUMN IF EXISTS api_key_tag,
      DROP COLUMN IF EXISTS api_key_key_id
  `);
};

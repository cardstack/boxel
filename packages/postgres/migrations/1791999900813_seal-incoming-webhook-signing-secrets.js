// Adds the columns that hold `incoming_webhooks.signing_secret` sealed by the
// realm server's secrets-at-rest helper (AES-256-GCM: ciphertext, nonce, tag
// and the id of the data key that sealed it), and the time the current secret
// was issued, which reads report in place of the secret. The plain-text
// `signing_secret` column stays, kept in step by every write, so the previous
// code revision keeps working against this schema. A row that revision writes
// leaves `signing_secret_created_at` empty, and reads fall back to the row's
// `created_at`.
//
// The table holds the secrets that verify webhooks Boxel receives, so the
// read-only role used by dashboards and read-only database access loses
// SELECT on it, and so does every role that is a member of it, in case one was
// also granted SELECT directly. That role exists only where it was provisioned
// (staging and production), so the revoke is skipped wherever it doesn't.
// Every statement is idempotent, so running `up` again changes nothing.
//
// A role holding SELECT with the grant option can pass SELECT on, and a
// REVOKE removes only the grants its grantor made. So `up` revokes each SELECT
// grant those roles hold on the table or its columns acting as the role that
// made it, with CASCADE, which also removes every grant passed on from it.
// Acting as another role needs the migrating role to be a superuser or able
// to SET ROLE to it; where it isn't, `up` stops and names the grant rather
// than leave the table readable.
//
// Before revoking, `up` takes every SELECT grant on the table and its
// columns, and records the ones the revokes removed, including those CASCADE
// took from roles outside the read-only role: who made each grant (none for
// the table's owner), to whom, on which column (none for the whole table) and
// whether it carried the grant option, as this table's row in
// `readonly_role_revoked_select_grants`. That table is created only where the
// read-only role exists, and a second `up` keeps the first record. `down`
// grants back exactly the recorded grants, each acting as the role that made
// it once that role holds the grant option again, so every role ends up with
// the privileges it had before `up`. A database with no record for this table
// gets SELECT back on the read-only role alone. The proxy endpoints sealing
// migration keeps its record the same way, in the same table.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE incoming_webhooks
      ADD COLUMN IF NOT EXISTS signing_secret_ciphertext bytea,
      ADD COLUMN IF NOT EXISTS signing_secret_nonce bytea,
      ADD COLUMN IF NOT EXISTS signing_secret_tag bytea,
      ADD COLUMN IF NOT EXISTS signing_secret_key_id varchar,
      ADD COLUMN IF NOT EXISTS signing_secret_created_at timestamp
  `);
  pgm.sql(`
    UPDATE incoming_webhooks
      SET signing_secret_created_at = created_at
      WHERE signing_secret_created_at IS NULL
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
          WHERE tbl.oid = 'incoming_webhooks'::regclass
          UNION ALL
          SELECT col.attname, tbl.relowner, acl.*
          FROM pg_class tbl
          JOIN pg_attribute col ON col.attrelid = tbl.oid
          CROSS JOIN LATERAL aclexplode(col.attacl) acl
          WHERE tbl.oid = 'incoming_webhooks'::regclass
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
          SELECT held INTO withheld
            FROM jsonb_array_elements(remaining) held
            WHERE held->>'grantee' = 'readonly_role'
              OR held->>'grantee' IN (
                SELECT member.rolname
                FROM pg_auth_members membership
                JOIN pg_roles grp ON grp.oid = membership.roleid
                JOIN pg_roles member ON member.oid = membership.member
                WHERE grp.rolname = 'readonly_role'
              )
            LIMIT 1;
          EXIT WHEN withheld IS NULL;
          IF withheld->>'grantor' IS NOT NULL THEN
            BEGIN
              EXECUTE format('SET ROLE %I', withheld->>'grantor');
            EXCEPTION WHEN insufficient_privilege THEN
              RAISE EXCEPTION
                'cannot revoke the SELECT on incoming_webhooks that % granted to %',
                withheld->>'grantor', withheld->>'grantee'
                USING HINT = format(
                  'Run the migration as a superuser or as a role that can SET ROLE %I.',
                  withheld->>'grantor'
                );
            END;
          END IF;
          EXECUTE format(
            'REVOKE SELECT ON TABLE incoming_webhooks FROM %I CASCADE',
            withheld->>'grantee'
          );
          EXECUTE format('SET ROLE %I', migrating_role);
          EXECUTE snapshot INTO remaining;
          IF EXISTS (
            SELECT 1 FROM jsonb_array_elements(remaining) held
            WHERE held->'grantor' = withheld->'grantor'
              AND held->'grantee' = withheld->'grantee'
          ) THEN
            RAISE EXCEPTION 'the SELECT on incoming_webhooks that % granted to % survived its REVOKE',
              COALESCE(withheld->>'grantor', 'the owner'), withheld->>'grantee';
          END IF;
        END LOOP;
        INSERT INTO readonly_role_revoked_select_grants (table_name, grants)
          SELECT 'incoming_webhooks',
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
          WHERE table_name = 'incoming_webhooks'
          RETURNING grants INTO recorded;
      END IF;
      IF recorded IS NULL THEN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_role') THEN
          GRANT SELECT ON TABLE incoming_webhooks TO readonly_role;
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
              WHERE attrelid = 'incoming_webhooks'::regclass
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
              IF NOT (
                CASE WHEN revoked->>'column' IS NULL
                  THEN has_table_privilege(
                    revoked->>'grantor',
                    'incoming_webhooks',
                    'SELECT WITH GRANT OPTION'
                  )
                  ELSE has_column_privilege(
                    revoked->>'grantor',
                    'incoming_webhooks',
                    revoked->>'column',
                    'SELECT WITH GRANT OPTION'
                  )
                END
              ) THEN
                waiting := waiting || jsonb_build_array(revoked);
                CONTINUE;
              END IF;
              EXECUTE format('SET ROLE %I', revoked->>'grantor');
            END IF;
            EXECUTE format(
              'GRANT SELECT%s ON TABLE incoming_webhooks TO %s%s',
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
    ALTER TABLE incoming_webhooks
      DROP COLUMN IF EXISTS signing_secret_ciphertext,
      DROP COLUMN IF EXISTS signing_secret_nonce,
      DROP COLUMN IF EXISTS signing_secret_tag,
      DROP COLUMN IF EXISTS signing_secret_key_id,
      DROP COLUMN IF EXISTS signing_secret_created_at
  `);
};

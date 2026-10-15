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
// Before revoking, `up` records which of those roles held SELECT on the table
// directly, and whether each could grant it on, as this table's row in
// `readonly_role_revoked_select_grants`. That table is created only where the
// read-only role exists, and a second `up` keeps the first record. `down`
// grants back exactly the recorded grants, so every role ends up with the
// privileges it had before `up`. A database with no record for this table
// gets SELECT back on the read-only role alone. The incoming webhooks sealing
// migration keeps its record the same way, in the same table.

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
      member_name name;
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_role') THEN
        CREATE TABLE IF NOT EXISTS readonly_role_revoked_select_grants (
          table_name text PRIMARY KEY,
          grants jsonb NOT NULL
        );
        INSERT INTO readonly_role_revoked_select_grants (table_name, grants)
          SELECT
            'proxy_endpoints',
            COALESCE(
              jsonb_agg(
                jsonb_build_object('grantee', grantee, 'grantable', grantable)
                ORDER BY grantee
              ),
              '[]'::jsonb
            )
          FROM (
            SELECT grantee_role.rolname AS grantee,
              bool_or(acl.is_grantable) AS grantable
            FROM pg_class tbl
            CROSS JOIN LATERAL aclexplode(tbl.relacl) acl
            JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
            WHERE tbl.oid = 'proxy_endpoints'::regclass
              AND acl.privilege_type = 'SELECT'
              AND (
                grantee_role.rolname = 'readonly_role'
                OR grantee_role.oid IN (
                  SELECT membership.member
                  FROM pg_auth_members membership
                  JOIN pg_roles grp ON grp.oid = membership.roleid
                  WHERE grp.rolname = 'readonly_role'
                )
              )
            GROUP BY grantee_role.rolname
          ) direct_grants
          ON CONFLICT (table_name) DO NOTHING;
        REVOKE SELECT ON TABLE proxy_endpoints FROM readonly_role;
        FOR member_name IN
          SELECT member.rolname
          FROM pg_auth_members membership
          JOIN pg_roles grp ON grp.oid = membership.roleid
          JOIN pg_roles member ON member.oid = membership.member
          WHERE grp.rolname = 'readonly_role'
        LOOP
          EXECUTE format(
            'REVOKE SELECT ON TABLE proxy_endpoints FROM %I',
            member_name
          );
        END LOOP;
      END IF;
    END
    $$
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DO $$
    DECLARE
      recorded jsonb;
      revoked jsonb;
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
        FOR revoked IN SELECT jsonb_array_elements(recorded)
        LOOP
          IF EXISTS (
            SELECT 1 FROM pg_roles WHERE rolname = revoked->>'grantee'
          ) THEN
            EXECUTE format(
              'GRANT SELECT ON TABLE proxy_endpoints TO %I%s',
              revoked->>'grantee',
              CASE WHEN (revoked->>'grantable')::boolean
                THEN ' WITH GRANT OPTION' ELSE '' END
            );
          END IF;
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

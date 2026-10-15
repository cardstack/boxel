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
// Before revoking, `up` records which of those roles held SELECT on the table
// directly, and whether each could grant it on, as this table's row in
// `readonly_role_revoked_select_grants`. That table is created only where the
// read-only role exists, and a second `up` keeps the first record. `down`
// grants back exactly the recorded grants, so every role ends up with the
// privileges it had before `up`. A database with no record for this table
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
      member_name name;
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_role') THEN
        CREATE TABLE IF NOT EXISTS readonly_role_revoked_select_grants (
          table_name text PRIMARY KEY,
          grants jsonb NOT NULL
        );
        INSERT INTO readonly_role_revoked_select_grants (table_name, grants)
          SELECT
            'incoming_webhooks',
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
            WHERE tbl.oid = 'incoming_webhooks'::regclass
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
        REVOKE SELECT ON TABLE incoming_webhooks FROM readonly_role;
        FOR member_name IN
          SELECT member.rolname
          FROM pg_auth_members membership
          JOIN pg_roles grp ON grp.oid = membership.roleid
          JOIN pg_roles member ON member.oid = membership.member
          WHERE grp.rolname = 'readonly_role'
        LOOP
          EXECUTE format(
            'REVOKE SELECT ON TABLE incoming_webhooks FROM %I',
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
          WHERE table_name = 'incoming_webhooks'
          RETURNING grants INTO recorded;
      END IF;
      IF recorded IS NULL THEN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_role') THEN
          GRANT SELECT ON TABLE incoming_webhooks TO readonly_role;
        END IF;
      ELSE
        FOR revoked IN SELECT jsonb_array_elements(recorded)
        LOOP
          IF EXISTS (
            SELECT 1 FROM pg_roles WHERE rolname = revoked->>'grantee'
          ) THEN
            EXECUTE format(
              'GRANT SELECT ON TABLE incoming_webhooks TO %I%s',
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
    ALTER TABLE incoming_webhooks
      DROP COLUMN IF EXISTS signing_secret_ciphertext,
      DROP COLUMN IF EXISTS signing_secret_nonce,
      DROP COLUMN IF EXISTS signing_secret_tag,
      DROP COLUMN IF EXISTS signing_secret_key_id,
      DROP COLUMN IF EXISTS signing_secret_created_at
  `);
};

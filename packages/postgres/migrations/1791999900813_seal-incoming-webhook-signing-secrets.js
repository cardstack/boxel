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
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_role') THEN
        GRANT SELECT ON TABLE incoming_webhooks TO readonly_role;
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

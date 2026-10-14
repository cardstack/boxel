// Adds the columns that hold `proxy_endpoints.api_key` sealed by the realm
// server's secrets-at-rest helper (AES-256-GCM: ciphertext, nonce, tag and
// the id of the data key that sealed it). The plain-text `api_key` column
// stays, kept in step by every write, so the previous code revision keeps
// working against this schema.
//
// The table holds the platform's own vendor keys, so the read-only role used
// by dashboards and read-only database access loses SELECT on it. That role
// exists only where it was provisioned (staging and production), so the
// revoke is skipped wherever it doesn't. Every statement is idempotent, so
// running `up` again changes nothing.

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
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_role') THEN
        REVOKE SELECT ON TABLE proxy_endpoints FROM readonly_role;
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
        GRANT SELECT ON TABLE proxy_endpoints TO readonly_role;
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

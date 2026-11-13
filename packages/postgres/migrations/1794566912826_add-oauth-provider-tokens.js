// The access and refresh tokens of Boxel's OAuth provider (ADR 021 §1.2), and
// the time each user's OAuth grants were last revoked (§1.5, §1.9).
//
// `oauth_provider_tokens` holds one row per token, found only by the SHA-256
// of the token's value (`id_hash`), never the value itself. `payload` is the
// library's payload without its copy of the value (`jti`). `grant_id` is the
// OAuth grant the token was issued from; a grant's tokens are deleted when it
// ends, and with it when the grant row itself is deleted. `resource` is the
// resource an access token is bound to (its audience), and the resource a
// refresh token's grant was asked for; `scope` is the token's own scopes,
// space-separated. A refresh token also records which rotation of its grant's
// chain it is (`rotation`, 0 for the one the code exchange issued), when it
// was first used (`consumed_at`), and when it was revoked because a sibling,
// issued from the same token, was used first (`revoked_at`).
//
// `users.oauth_grants_revoked_at` is when the user's OAuth grants were last
// revoked: by an operator's revocation of their sessions, or by the first
// revocation after a password change, never by the later one that covers
// Matrix OpenID tokens. A grant created at or before it is refused.
//
// The read-only role may read the token table: it holds no secret, and it is
// what explains a connection's activity. `readonly_role` exists only where it
// was provisioned (staging and production), so the grant is skipped wherever
// it doesn't.
//
// The realm server alone reads the token table, so it is excluded from the
// SQLite schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS oauth_provider_tokens (
      id_hash bytea PRIMARY KEY,
      kind varchar NOT NULL,
      grant_id varchar NOT NULL
        REFERENCES oauth_provider_grants(id) ON DELETE CASCADE,
      resource varchar,
      scope varchar NOT NULL,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      rotation integer,
      consumed_at timestamptz,
      revoked_at timestamptz
    )
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS oauth_provider_tokens_grant_id_index
      ON oauth_provider_tokens (grant_id)
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS oauth_provider_tokens_expires_at_index
      ON oauth_provider_tokens (expires_at)
  `);
  pgm.sql(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS oauth_grants_revoked_at timestamptz
  `);
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_role') THEN
        GRANT SELECT ON TABLE oauth_provider_tokens TO readonly_role;
      END IF;
    END
    $$
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS oauth_provider_tokens`);
  pgm.sql(`ALTER TABLE users DROP COLUMN IF EXISTS oauth_grants_revoked_at`);
};

// The OAuth grants of Boxel's OAuth provider (ADR 021 §1.3): one row for each
// consent, holding exactly the scopes the user approved at each resource the
// flow named. A consent never merges into, widens or replaces an earlier row.
//
// `id` is the grant's identifier as the provider issued it. It is no bearer
// secret: the provider's tokens refer to it, and no request presents it.
// `user_id` is the user's internal ID, never their Matrix ID. `client_id` is
// the client as the provider knows it. It has no foreign key, since a
// pre-registered client is listed in code and a client identified by a client
// ID metadata document is never stored, and an ended grant is kept after its
// client registered by dynamic client registration is deleted. `resources`
// maps each resource identifier to the scopes approved there. `renewing` is
// the user's choice to keep the connection (ADR 021 §1.9), which sets
// `expires_at`.
//
// An ended grant is kept, with when and why it ended (`ended_at`,
// `ended_reason`), so the lookup and telemetry can still say who ended it.
// `last_used_at` is when a token of the grant was last accepted.
//
// The read-only role used by dashboards and read-only database access may read
// the table: it holds no secret, and it is what explains a user's connections.
// `readonly_role` exists only where it was provisioned (staging and
// production), so the grant is skipped wherever it doesn't.
//
// The realm server alone reads the table, so it is excluded from the SQLite
// schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS oauth_provider_grants (
      id varchar PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id),
      client_id varchar NOT NULL,
      resources jsonb NOT NULL,
      renewing boolean NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      ended_at timestamptz,
      ended_reason varchar,
      last_used_at timestamptz
    )
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS oauth_provider_grants_user_id_index
      ON oauth_provider_grants (user_id)
  `);
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_role') THEN
        GRANT SELECT ON TABLE oauth_provider_grants TO readonly_role;
      END IF;
    END
    $$
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS oauth_provider_grants`);
};

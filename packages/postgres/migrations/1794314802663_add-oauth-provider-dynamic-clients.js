// The clients that registered themselves with Boxel's OAuth provider by
// dynamic client registration (ADR 021 §1.4). Not Boxel acting as an OAuth
// client of other services: that is `oauth_clients`.
//
// `client_id` is the identifier the provider issued, stored as issued: it is
// no secret, since every request the client makes carries it, and the
// provider issues no client secrets. `metadata` is the client as the provider
// stores it (its redirect URIs, grant types, application type and name).
// `created_at` is when it registered, which the cleanup of clients that never
// connect reads.
//
// It holds only those clients, as its name says, not every client the
// provider knows. A client identified by a client ID metadata document is
// never stored here: the provider downloads its document and keeps it in
// memory. Pre-registered clients are listed in code.
//
// The read-only role used by dashboards and read-only database access may read
// the table: it holds no secret, and it is what explains why a client can't
// connect. `readonly_role` exists only where it was provisioned (staging and
// production), so the grant is skipped wherever it doesn't.
//
// The realm server alone reads the table, so it is excluded from the SQLite
// schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS oauth_provider_dynamic_clients (
      client_id varchar PRIMARY KEY,
      metadata jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_role') THEN
        GRANT SELECT ON TABLE oauth_provider_dynamic_clients TO readonly_role;
      END IF;
    END
    $$
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS oauth_provider_dynamic_clients`);
};

// The short-lived objects of Boxel's OAuth provider (ADR 021 §1.2): the
// library's interactions, and the error references Boxel's error page reads
// (§1.8). Each lives minutes.
//
// `kind` is the library's model name, or Boxel's own for an object the library
// doesn't know. A row is found only by the SHA-256 of the object's value
// (`id_hash`). The value is not stored: the provider's adapter takes it out of
// `payload` and puts it back when the row is found.
//
// `expires_at` is when the object stops being found. A row past it reads as
// missing, whether or not it has been deleted yet.
//
// The read-only role is not granted the table: a row holds nothing that
// explains a refusal, which the provider logs instead.
//
// The realm server alone reads the table, so it is excluded from the SQLite
// schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS oauth_provider_objects (
      kind varchar NOT NULL,
      id_hash bytea NOT NULL,
      payload jsonb NOT NULL,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (kind, id_hash)
    )
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS oauth_provider_objects_expires_at_index
      ON oauth_provider_objects (expires_at)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS oauth_provider_objects`);
};

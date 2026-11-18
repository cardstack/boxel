// The redirect URI of the flow that created each OAuth grant of Boxel's OAuth
// provider. Connected apps names a client that registered itself by its
// redirect URI's registrable domain, as consent did (ADR 021 §1.4), and such
// a client may register several redirect URIs, on different hosts. Null for a
// grant created before the column existed, which Connected apps names as an
// unknown app.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE oauth_provider_grants
      ADD COLUMN IF NOT EXISTS redirect_uri varchar
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE oauth_provider_grants DROP COLUMN IF EXISTS redirect_uri`);
};

// When an OAuth grant first connected its app, and when a client registered
// by dynamic client registration last did.
//
// `oauth_provider_grants.exchanged_at` is when a token was first stored for
// the grant: when its authorization code was exchanged. A grant the user
// approved but whose code was never exchanged never connected anything.
// Every existing grant counts as exchanged: at its earliest token still
// stored, or at its creation when none is (ending a grant deletes its
// tokens). Counting one that never was keeps its client longer, never
// deletes it early.
//
// `oauth_provider_dynamic_clients.last_connected_at` is when one of the
// client's grants was last exchanged. NULL means the client has never
// connected. Existing clients take their latest grant's `exchanged_at`.
//
// The OAuth provider's daily cleanup reads both. It deletes a client that
// never connected 7 days after it registered, and one whose last connection
// ended 30 days ago. Its grants say when that was, but they don't say whether
// the client ever connected once they are gone: a user's grants are deleted
// with the user, and ended grants are deleted 90 days after they end.
//
// The index on the grants' `client_id` finds a client's grants, which the
// cleanup reads for each client.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE oauth_provider_grants
      ADD COLUMN IF NOT EXISTS exchanged_at timestamptz
  `);
  pgm.sql(`
    ALTER TABLE oauth_provider_dynamic_clients
      ADD COLUMN IF NOT EXISTS last_connected_at timestamptz
  `);
  pgm.sql(`
    UPDATE oauth_provider_grants AS g
       SET exchanged_at = COALESCE(
             (SELECT min(t.created_at) FROM oauth_provider_tokens AS t
               WHERE t.grant_id = g.id),
             g.created_at
           )
     WHERE g.exchanged_at IS NULL
  `);
  pgm.sql(`
    UPDATE oauth_provider_dynamic_clients AS c
       SET last_connected_at = g.last_exchanged_at
      FROM (
        SELECT client_id, max(exchanged_at) AS last_exchanged_at
          FROM oauth_provider_grants
         WHERE exchanged_at IS NOT NULL
         GROUP BY client_id
      ) AS g
     WHERE g.client_id = c.client_id
       AND c.last_connected_at IS NULL
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS oauth_provider_grants_client_id_index
      ON oauth_provider_grants (client_id)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS oauth_provider_grants_client_id_index`);
  pgm.sql(
    `ALTER TABLE oauth_provider_dynamic_clients DROP COLUMN IF EXISTS last_connected_at`,
  );
  pgm.sql(
    `ALTER TABLE oauth_provider_grants DROP COLUMN IF EXISTS exchanged_at`,
  );
};

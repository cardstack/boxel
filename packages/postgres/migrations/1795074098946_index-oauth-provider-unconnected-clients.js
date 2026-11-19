// An index over the clients registered by dynamic client registration that
// have never connected (`last_connected_at` is NULL). Registration counts them
// before storing another, and refuses once the provider holds as many as it
// keeps; the daily cleanup deletes them 7 days after they register.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS oauth_provider_dynamic_clients_unconnected_index
      ON oauth_provider_dynamic_clients (created_at)
      WHERE last_connected_at IS NULL
  `);
};

exports.down = (pgm) => {
  pgm.sql(
    `DROP INDEX IF EXISTS oauth_provider_dynamic_clients_unconnected_index`,
  );
};

// How a site's routed page looks when shared: og:title, og:description and
// og:image, from its page type's share expressions, evaluated when the route
// table is built. Null for a page whose page type sets none.
//
// `host_routes` is excluded from the SQLite schema dump: only the realm
// server reads it.

exports.up = (pgm) => {
  pgm.addColumns('host_routes', {
    share: { type: 'jsonb' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('host_routes', ['share']);
};

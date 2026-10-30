// The route table host mode serves a site's paths from. Each row is one path
// of one routing realm: a card's page, an alias that answers 301 to a page, a
// listing, or a page that is gone (410). The realm server rebuilds a realm's
// rows from its site settings and the cards they name, and serve-index looks
// a request's path up here before falling back to the routing rules.
//
// `claimed_at` is when a path was first claimed. When two cards claim one
// path, the older claim keeps it, so a new card can't take over an address
// people already share.
//
// `host_routes` is excluded from the SQLite schema dump: only the realm
// server reads it.

exports.up = (pgm) => {
  pgm.createTable('host_routes', {
    realm_url: { type: 'varchar', notNull: true },
    path: { type: 'varchar', notNull: true },
    kind: { type: 'varchar', notNull: true },
    card_url: { type: 'varchar' },
    target_path: { type: 'varchar' },
    page_type: { type: 'integer' },
    claimed_at: { type: 'bigint', notNull: true },
    updated_at: { type: 'bigint', notNull: true },
  });
  pgm.addConstraint('host_routes', 'host_routes_pkey', {
    primaryKey: ['realm_url', 'path'],
  });
  pgm.createIndex('host_routes', ['realm_url', 'card_url']);
};

exports.down = (pgm) => {
  pgm.dropTable('host_routes');
};

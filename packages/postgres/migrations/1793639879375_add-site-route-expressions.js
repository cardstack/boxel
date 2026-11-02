// The BXL expressions a realm's cards need evaluated for the sites that draw
// on it (ADR site-routing §1.3). A site's page type can derive a path
// segment from a card with an expression; the card's realm stores each
// value in the card's search doc when the card is indexed, and this registry
// tells that realm's indexer which expressions to run for which card types.
// It holds expressions, never addresses. Written when a site realm's
// settings are read after it is indexed. Excluded from the SQLite schema
// dump: the host's in-browser index serves no sites.

exports.up = (pgm) => {
  pgm.createTable('site_route_expressions', {
    // The realm whose cards the expression runs over.
    realm_url: { type: 'varchar', notNull: true },
    // The card type, as boxel_index.types spells it.
    card_type: { type: 'varchar', notNull: true },
    // routeKey(card_type, expression): where the value sits under `_route`.
    route_key: { type: 'varchar', notNull: true },
    expression: { type: 'text', notNull: true },
    // The site realm whose settings asked for it.
    site_realm_url: { type: 'varchar', notNull: true },
  });
  pgm.addConstraint('site_route_expressions', 'site_route_expressions_pkey', {
    primaryKey: ['realm_url', 'card_type', 'route_key', 'site_realm_url'],
  });
  pgm.createIndex('site_route_expressions', ['site_realm_url']);
};

exports.down = (pgm) => {
  pgm.dropTable('site_route_expressions');
};

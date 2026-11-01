// The cards a realm's event feed has announced as readable by its audience
// and not since as removed or withdrawn (ADR 023 §1.2). Every process serving
// the realm records them as it appends to the feed, so a removal is announced
// for a card a visitor could have seen whichever process announced it, and
// after a restart. Excluded from the SQLite schema dump with the other feed
// tables: a realm the host runs in the browser keeps its feed in memory.

exports.up = (pgm) => {
  pgm.createTable('realm_feed_visible', {
    feed_key: { type: 'varchar', notNull: true },
    path: { type: 'varchar', notNull: true },
  });
  pgm.addConstraint('realm_feed_visible', 'realm_feed_visible_pkey', {
    primaryKey: ['feed_key', 'path'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable('realm_feed_visible');
};

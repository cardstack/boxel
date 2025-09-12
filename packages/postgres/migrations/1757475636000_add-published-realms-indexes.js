exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createIndex('published_realms', 'source_realm_url');
  pgm.createIndex('published_realms', 'published_realm_url');
};

exports.down = (pgm) => {
  pgm.dropIndex('published_realms', 'source_realm_url');
  pgm.dropIndex('published_realms', 'published_realm_url');
};

let table = 'realm_meta';

exports.up = pgm => {
  pgm.createTable(table, {
    key: { type: 'varchar', notNull: true },
    realm_version: { type: 'integer', notNull: true },
    realm_url: { type: 'varchar', notNull: true },
    value: { type: 'jsonb', notNull: true },
    indexed_at: 'bigint',
  });
  pgm.addConstraint(table, 'realm_meta_pkey', {
    primaryKey: ['key', 'realm_version', 'realm_url'],
  });
  pgm.createIndex(table, ['key']);
  pgm.createIndex(table, ['realm_version']);
  pgm.createIndex(table, ['realm_url']);
};

exports.down = pgm => {
  pgm.dropTable(table);
};

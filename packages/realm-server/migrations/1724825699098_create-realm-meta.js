let table = 'realm_meta';

exports.up = pgm => {
  pgm.addColumns('boxel_index', {
    display_names: 'jsonb',
  });
  pgm.createTable(table, {
    realm_url: { type: 'varchar', notNull: true },
    realm_version: { type: 'integer', notNull: true },
    value: { type: 'jsonb', notNull: true },
    indexed_at: 'bigint',
  });
  pgm.addConstraint(table, 'realm_meta_pkey', {
    primaryKey: ['realm_url', 'realm_version'],
  });
  pgm.createIndex(table, ['realm_url']);
  pgm.createIndex(table, ['realm_version']);
};

exports.down = pgm => {
  pgm.dropColumns('boxel_index', {
    display_names: 'jsonb',
  });
  pgm.dropTable(table);
};

exports.up = (pgm) => {
  pgm.createTable('realm_file_meta', {
    realm_url: { type: 'varchar', notNull: true },
    file_path: { type: 'varchar', notNull: true },
    // store as epoch seconds (integer) to align with existing conventions
    created_at: {
      type: 'integer',
      notNull: true,
    },
  });

  pgm.addConstraint('realm_file_meta', 'realm_file_meta_pkey', {
    primaryKey: ['realm_url', 'file_path'],
  });

  pgm.createIndex('realm_file_meta', ['realm_url']);
  pgm.createIndex('realm_file_meta', ['created_at']);
};

exports.down = (pgm) => {
  pgm.dropTable('realm_file_meta');
};

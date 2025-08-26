exports.up = (pgm) => {
  pgm.createTable('server_config', {
    key: { type: 'varchar', notNull: true },
    value: { type: 'jsonb', notNull: true },
    created_at: {
      type: 'timestamp',
      notNull: true,
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
    },
  });

  pgm.addConstraint('server_config', 'server_config_pkey', {
    primaryKey: ['key'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable('server_config');
};

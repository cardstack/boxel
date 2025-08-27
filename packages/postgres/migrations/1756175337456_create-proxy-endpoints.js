exports.up = (pgm) => {
  pgm.createTable('proxy_endpoints', {
    id: { type: 'uuid', primaryKey: true, notNull: true },
    url: { type: 'varchar', notNull: true, unique: true },
    api_key: { type: 'varchar', notNull: true },
    credit_strategy: { type: 'varchar', notNull: true },
    supports_streaming: { type: 'boolean', notNull: true },
    auth_method: { type: 'varchar' },
    auth_parameter_name: { type: 'varchar' },
    created_at: {
      type: 'timestamp',
      notNull: true,
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
    },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('proxy_endpoints');
};

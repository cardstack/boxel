exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('bot_registrations', {
    id: {
      type: 'uuid',
      notNull: true,
      primaryKey: true,
    },
    username: {
      type: 'text',
      notNull: true,
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
    },
  });

  pgm.createIndex('bot_registrations', 'username');
};

exports.down = (pgm) => {
  pgm.dropIndex('bot_registrations', 'username');
  pgm.dropTable('bot_registrations');
};

exports.up = (pgm) => {
  pgm.createTable('bot_registrations', {
    id: { type: 'uuid', primaryKey: true, notNull: true },
    username: { type: 'text', notNull: true },
    created_at: { type: 'timestamp', notNull: true },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('bot_registrations');
};

exports.up = (pgm) => {
  pgm.createTable('bot_registrations', {
    id: { type: 'uuid', primaryKey: true, notNull: true },
    user_id: { type: 'uuid', notNull: true },
    name: { type: 'text' },
    created_at: { type: 'timestamp', notNull: true },
  });
  pgm.addConstraint('bot_registrations', 'bot_registrations_user_name_unique', {
    unique: ['user_id', 'name'],
  });
  pgm.addConstraint('bot_registrations', 'bot_registrations_user_id_fkey', {
    foreignKeys: {
      columns: 'user_id',
      references: 'users(id)',
      onDelete: 'CASCADE',
    },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('bot_registrations');
};

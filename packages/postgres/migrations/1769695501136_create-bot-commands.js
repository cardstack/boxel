exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('bot_commands', {
    id: {
      type: 'uuid',
      notNull: true,
      primaryKey: true,
    },
    bot_id: {
      type: 'uuid',
      notNull: true,
      references: 'bot_registrations(id)',
      onDelete: 'cascade',
    },
    command: {
      type: 'text',
      notNull: true,
    },
    filter: {
      type: 'jsonb',
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
    },
  });

  pgm.createIndex('bot_commands', 'bot_id');
};

exports.down = (pgm) => {
  pgm.dropIndex('bot_commands', 'bot_id');
  pgm.dropTable('bot_commands');
};

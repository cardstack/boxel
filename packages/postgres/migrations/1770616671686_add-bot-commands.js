 

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
      onDelete: 'CASCADE',
    },
    command: {
      type: 'text',
      notNull: true,
    },
    command_filter: {
      type: 'jsonb',
      notNull: true,
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
    },
  });
  pgm.createIndex('bot_commands', ['bot_id', 'created_at']);
};

exports.down = (pgm) => {
  pgm.dropIndex('bot_commands', ['bot_id', 'created_at']);
  pgm.dropTable('bot_commands');
};

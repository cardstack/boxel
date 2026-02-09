 

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
};

exports.down = (pgm) => {
  pgm.dropTable('bot_commands');
};

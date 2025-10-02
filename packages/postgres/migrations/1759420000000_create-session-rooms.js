exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    'session_rooms',
    {
      realm_url: {
        type: 'varchar',
        notNull: true,
      },
      matrix_user_id: {
        type: 'varchar',
        notNull: true,
      },
      room_id: {
        type: 'varchar',
        notNull: true,
      },
      created_at: {
        type: 'timestamp',
        notNull: true,
        default: pgm.func('current_timestamp'),
      },
      updated_at: {
        type: 'timestamp',
        notNull: true,
        default: pgm.func('current_timestamp'),
      },
    },
    {
      constraints: {
        primaryKey: ['realm_url', 'matrix_user_id'],
      },
    },
  );
};

exports.down = (pgm) => {
  pgm.dropTable('session_rooms');
};

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('session_rooms', {
    matrix_user_id: {
      type: 'varchar',
      notNull: true,
      primaryKey: true,
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
  });
};

exports.down = (pgm) => {
  pgm.dropTable('session_rooms');
};

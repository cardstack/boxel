exports.up = (pgm) => {
  pgm.addColumns('users', {
    session_room_id: { type: 'varchar' },
  });

  pgm.sql(`
    UPDATE users
    SET session_room_id = sr.room_id
    FROM session_rooms sr
    WHERE users.matrix_user_id = sr.matrix_user_id
      AND sr.realm_url = '__realm-server__'
  `);

  pgm.dropTable('session_rooms');
};

exports.down = (pgm) => {
  pgm.createTable(
    'session_rooms',
    {
      realm_url: { type: 'varchar', notNull: true },
      realm_user_id: { type: 'varchar' },
      matrix_user_id: { type: 'varchar', notNull: true },
      room_id: { type: 'varchar', notNull: true },
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

  pgm.sql(`
    INSERT INTO session_rooms (realm_url, matrix_user_id, room_id)
    SELECT '__realm-server__', matrix_user_id, session_room_id
    FROM users
    WHERE session_room_id IS NOT NULL
  `);

  pgm.dropColumns('users', ['session_room_id']);
};

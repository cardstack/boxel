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
};

exports.down = (pgm) => {
  pgm.dropColumns('users', ['session_room_id']);
};

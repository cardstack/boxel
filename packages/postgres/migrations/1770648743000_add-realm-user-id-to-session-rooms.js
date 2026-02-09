exports.up = (pgm) => {
  pgm.addColumns('session_rooms', {
    realm_user_id: { type: 'varchar' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('session_rooms', ['realm_user_id']);
};

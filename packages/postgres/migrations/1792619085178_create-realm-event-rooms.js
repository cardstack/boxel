// The Matrix room a world-readable realm sends its realm events into, shared by
// every host that has joined it. A realm has at most one; its row is written
// the first time a host asks for the room.

exports.up = (pgm) => {
  pgm.createTable('realm_event_rooms', {
    realm_url: {
      type: 'varchar',
      notNull: true,
      primaryKey: true,
    },
    room_id: {
      type: 'varchar',
      notNull: true,
    },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('realm_event_rooms', { ifExists: true });
};

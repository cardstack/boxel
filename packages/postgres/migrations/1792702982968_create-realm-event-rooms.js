// The Matrix room a private realm sends its realm events into. Its members are
// the users the realm's grants name, so each event is stored once rather than
// once per member's session room. A realm has at most one; its row is written
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

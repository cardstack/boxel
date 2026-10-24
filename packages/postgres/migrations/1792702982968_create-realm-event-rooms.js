// The Matrix room a private realm sends its realm events into. Its members are
// the users the realm's grants name, so each event is stored once rather than
// once per member's session room. A realm has at most one; its row is written
// once the room's first invites have gone out.
//
// A room that stops being the realm's (a grant was revoked, the realm was
// deleted, or another process stored its room first) is retired: it moves to
// retired_realm_event_rooms until every member has been removed and the realm
// server has left it, so a removal that fails is tried again rather than
// forgotten.

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
  pgm.createTable('retired_realm_event_rooms', {
    room_id: {
      type: 'varchar',
      notNull: true,
      primaryKey: true,
    },
    realm_url: {
      type: 'varchar',
      notNull: true,
    },
  });
  pgm.createIndex('retired_realm_event_rooms', 'realm_url');
};

exports.down = (pgm) => {
  pgm.dropTable('retired_realm_event_rooms', { ifExists: true });
  pgm.dropTable('realm_event_rooms', { ifExists: true });
};

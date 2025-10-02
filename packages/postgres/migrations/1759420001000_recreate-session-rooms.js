exports.shorthands = undefined;

const createSessionRoomsTable = (pgm, withRealm = true) => {
  if (withRealm) {
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
  } else {
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
  }
};

exports.up = (pgm) => {
  pgm.dropTable('session_rooms', { ifExists: true });
  createSessionRoomsTable(pgm, true);
};

exports.down = (pgm) => {
  pgm.dropTable('session_rooms', { ifExists: true });
  createSessionRoomsTable(pgm, false);
};

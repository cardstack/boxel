/* eslint-disable camelcase */

exports.shorthands = undefined;

let table = 'realm_user_permissions';

exports.up = (pgm) => {
  pgm.createTable(table, {
    realm_url: { type: 'varchar', notNull: true },
    username: { type: 'varchar', notNull: true },
    read: { type: 'boolean', notNull: true },
    write: { type: 'boolean', notNull: true },
  });

  pgm.addConstraint(table, 'unique_realm_user_permissions', {
    primaryKey: ['realm_url', 'username', 'read', 'write'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable(table);
};

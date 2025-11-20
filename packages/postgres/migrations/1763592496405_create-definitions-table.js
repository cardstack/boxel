/* eslint-disable camelcase */

exports.shorthands = undefined;

let table = 'modules';

exports.up = (pgm) => {
  pgm.createTable(table, {
    url: { type: 'varchar', notNull: true },
    definitions: 'jsonb',
    deps: 'jsonb',
    error_doc: 'jsonb',
    created_at: 'bigint',
    realm_url: { type: 'varchar', notNull: true },
  });
  pgm.sql(`ALTER TABLE ${table} SET UNLOGGED`);
  pgm.addConstraint(table, `${table}_pkey`, {
    primaryKey: ['url'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable(table);
};

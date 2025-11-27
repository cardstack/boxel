exports.shorthands = undefined;

let table = 'modules';

exports.up = (pgm) => {
  pgm.createTable(table, {
    url: { type: 'varchar', notNull: true },
    cache_scope: {
      type: 'varchar',
      notNull: true,
    },
    auth_user_id: {
      type: 'varchar',
      notNull: true,
    },
    resolved_realm_url: {
      type: 'varchar',
      notNull: true,
    },
    definitions: 'jsonb',
    deps: 'jsonb',
    error_doc: 'jsonb',
    created_at: 'bigint',
  });
  pgm.sql(`ALTER TABLE ${table} SET UNLOGGED`);
  pgm.addConstraint(table, `${table}_pkey`, {
    primaryKey: ['url', 'cache_scope', 'auth_user_id'],
  });
  pgm.addIndex(table, ['resolved_realm_url']);
};

exports.down = (pgm) => {
  pgm.dropIndex(table, ['resolved_realm_url']);
  pgm.dropConstraint(table, `${table}_pkey`);
  pgm.dropTable(table);
};

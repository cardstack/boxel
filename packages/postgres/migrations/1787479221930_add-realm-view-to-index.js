exports.shorthands = undefined;

const TABLE_KEYS = {
  boxel_index: ['url', 'realm_url', 'realm_view', 'type'],
  boxel_index_working: ['url', 'realm_url', 'realm_view', 'type'],
  prerendered_html: ['url', 'realm_url', 'realm_view', 'type'],
  prerendered_html_working: ['url', 'realm_url', 'realm_view', 'type'],
  realm_generations: ['realm_url', 'realm_view'],
  realm_meta: ['realm_url', 'realm_view', 'generation'],
  realm_file_meta: ['realm_url', 'realm_view', 'file_path'],
};

const LIVE_KEYS = {
  boxel_index: ['url', 'realm_url', 'type'],
  boxel_index_working: ['url', 'realm_url', 'type'],
  prerendered_html: ['url', 'realm_url', 'type'],
  prerendered_html_working: ['url', 'realm_url', 'type'],
  realm_generations: ['realm_url'],
  realm_meta: ['realm_url', 'generation'],
  realm_file_meta: ['realm_url', 'file_path'],
};

exports.up = (pgm) => {
  for (let [table, primaryKey] of Object.entries(TABLE_KEYS)) {
    pgm.addColumn(table, {
      realm_view: {
        type: 'text',
        notNull: true,
        default: 'live',
      },
    });
    pgm.dropConstraint(table, `${table}_pkey`);
    pgm.addConstraint(table, `${table}_pkey`, { primaryKey });
  }
};

exports.down = (pgm) => {
  for (let [table, primaryKey] of Object.entries(LIVE_KEYS)) {
    pgm.sql(`DELETE FROM ${table} WHERE realm_view <> 'live'`);
    pgm.dropConstraint(table, `${table}_pkey`);
    pgm.dropColumn(table, 'realm_view');
    pgm.addConstraint(table, `${table}_pkey`, { primaryKey });
  }
};

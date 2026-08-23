exports.shorthands = undefined;

const LIVE_VIEW = 'live';

exports.up = (pgm) => {
  for (let table of ['modules', 'module_transpile_cache']) {
    pgm.addColumn(table, {
      realm_view: {
        type: 'varchar',
        notNull: true,
        default: LIVE_VIEW,
      },
    });
    pgm.dropConstraint(table, `${table}_pkey`);
  }

  pgm.addConstraint('modules', 'modules_pkey', {
    // Keep the bounded hash key introduced by
    // 1770889690032_index-row-size-max-error. The SQLite schema converter
    // maps url_hash back to url because SQLite cannot put a generated column
    // in a primary key.
    primaryKey: ['url_hash', 'realm_view', 'cache_scope', 'auth_user_id'],
  });
  pgm.addConstraint('module_transpile_cache', 'module_transpile_cache_pkey', {
    primaryKey: ['realm_url', 'realm_view', 'canonical_path'],
  });
  pgm.addIndex('modules', ['resolved_realm_url', 'realm_view']);
  pgm.addIndex('module_transpile_cache', ['realm_url', 'realm_view']);
};

exports.down = (pgm) => {
  // Both tables are derived caches. Exact rows cannot be represented by the
  // old keys and are safe to discard before restoring the live-only shape.
  for (let table of ['modules', 'module_transpile_cache']) {
    pgm.sql(`DELETE FROM ${table} WHERE realm_view <> '${LIVE_VIEW}'`);
    pgm.dropConstraint(table, `${table}_pkey`);
  }
  pgm.dropIndex('modules', ['resolved_realm_url', 'realm_view']);
  pgm.dropIndex('module_transpile_cache', ['realm_url', 'realm_view']);
  pgm.addConstraint('modules', 'modules_pkey', {
    primaryKey: ['url_hash', 'cache_scope', 'auth_user_id'],
  });
  pgm.addConstraint('module_transpile_cache', 'module_transpile_cache_pkey', {
    primaryKey: ['realm_url', 'canonical_path'],
  });
  for (let table of ['modules', 'module_transpile_cache']) {
    pgm.dropColumn(table, 'realm_view');
  }
};

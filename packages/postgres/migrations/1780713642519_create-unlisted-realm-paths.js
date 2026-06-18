exports.shorthands = undefined;

// Stores the server-issued random path segment for each source realm's
// "unlisted link" publish target (`<username>.<spaceDomain>/<slug>/`). The slug
// is generated and owned by the server so the unguessable string can't be
// chosen by a client via direct API calls; the publish handler only allows a
// subdirectory publish to this slug (or the realm name).
exports.up = (pgm) => {
  pgm.createTable('unlisted_realm_paths', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    source_realm_url: {
      type: 'varchar',
      notNull: true,
    },
    slug: {
      type: 'varchar',
      notNull: true,
    },
    owner_user_id: {
      type: 'varchar',
      notNull: true,
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('unlisted_realm_paths', ['source_realm_url'], {
    unique: true,
    name: 'unlisted_realm_paths_source_url_unique_index',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('unlisted_realm_paths', ['source_realm_url'], {
    name: 'unlisted_realm_paths_source_url_unique_index',
  });
  pgm.dropTable('unlisted_realm_paths');
};
